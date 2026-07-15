const startWebsite = (client) => {
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const Discord = require('discord.js');

const app = express();
const LOGO_URL = "https://cdn.discordapp.com/attachments/1491450273892143285/1526729536283349093/IMG_5977.webp?ex=6a58152e&is=6a56c3ae&hm=a17eb5802a4cf947f3238606c7c3580e253b866a2def9b3f4518069effc4e688&.png";
const BG_URL = "https://cdn.discordapp.com/attachments/1491450273892143285/1526730668611211264/IMG_5440.jpg";
const CLIENT_ID = '1526445155530576034';
const CLIENT_SECRET = 'Sz57nIWYPu8GFTNTgBkeNHseFGyUGMpu';
const GUILD_ID = '1418423847790579784';
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const REDIRECT_URI = `${BASE_URL}/callback`;
const MONGO_URI = process.env.MONGODB_URI;

mongoose.connect(MONGO_URI).then(() => console.log('MongoDB connected')).catch(e => console.error('MongoDB error:', e));

const { Schema, model } = mongoose;
const guildSchema = new Schema({ guild: String, joins: Array, policejoins: Array, joinChannels: Object, policeListMessage: String }, { strict: false });
const userSchema = new Schema({ guild: String, user: String, characters: Array }, { strict: false });
const guildBase = mongoose.models.guildBase || model('guildBase', guildSchema);
const userBase = mongoose.models.userBase || model('userBase', userSchema);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(session({
    secret: 'dt-military-secret-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

app.get('/login', (req, res) => {
    const url = `https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
    res.redirect(url);
});

app.get('/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect('/');
    try {
        const tokenRes = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI
        }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

        const accessToken = tokenRes.data.access_token;
        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        req.session.userId = userRes.data.id;
        req.session.username = userRes.data.username;
        req.session.avatar = userRes.data.avatar
            ? `https://cdn.discordapp.com/avatars/${userRes.data.id}/${userRes.data.avatar}.png`
            : `https://cdn.discordapp.com/embed/avatars/0.png`;
        res.redirect('/dashboard');
    } catch (e) {
        console.error(e);
        res.redirect('/');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get('/api/me', async (req, res) => {
    if (!req.session.userId) return res.json({ loggedIn: false });
    try {
        const db = await guildBase.findOne({ guild: GUILD_ID });
        const check = db?.joins?.find(j => j.user === req.session.userId);
        if (!check) return res.json({ loggedIn: true, registered: false, username: req.session.username, avatar: req.session.avatar });

        const userDoc = await userBase.findOne({ guild: GUILD_ID, user: req.session.userId });
        const character = userDoc?.characters?.[check.character];

        if (!character) return res.json({ loggedIn: true, registered: false, username: req.session.username, avatar: req.session.avatar });

        if (character.id?.job !== 'police') return res.json({ loggedIn: true, registered: true, authorized: false, username: req.session.username, avatar: req.session.avatar });

        const onDuty = !!db?.policejoins?.find(j => j.user === req.session.userId);

        return res.json({
            loggedIn: true,
            registered: true,
            authorized: true,
            username: req.session.username,
            avatar: req.session.avatar,
            onDuty,
            dutyTime: onDuty ? (req.session.dutyTime || null) : null,
            character: {
                first: character?.id?.first || '',
                last: character?.id?.last || '',
                number: character?.id?.number || 0,
                job: character?.id?.job || 'citizen',
                rank: character?.id?.police_data?.rank || '',
                sector: character?.id?.police_data?.sector || '',
                code: character?.id?.police_data?.code || '',
                characterIndex: check.character
            }
        });
    } catch (e) {
        console.error(e);
        res.json({ loggedIn: false });
    }
});

app.get('/api/duty/list', async (req, res) => {
    try {
        const db = await guildBase.findOne({ guild: GUILD_ID });
        const list = db?.policejoins || [];
        res.json({ list });
    } catch (e) {
        res.json({ list: [] });
    }
});

app.post('/api/duty/login', async (req, res) => {
    if (!req.session.userId) return res.json({ success: false, message: 'غير مسجل دخول' });
    try {
        const db = await guildBase.findOne({ guild: GUILD_ID });
        const check = db?.joins?.find(j => j.user === req.session.userId);
        if (!check) return res.json({ success: false, message: 'غير مسجل بهويتك في السيرفر' });

        const userDoc = await userBase.findOne({ guild: GUILD_ID, user: req.session.userId });
        const character = userDoc?.characters?.[check.character];

        if (!character) return res.json({ success: false, message: 'لا توجد شخصية' });
        if (character.id?.job !== 'police') return res.json({ success: false, message: 'هذا النظام للشرطة فقط' });
        if (character.prison?.status) return res.json({ success: false, message: 'لا يمكنك المباشرة وأنت في السجن' });
        if (character.clamped) return res.json({ success: false, message: 'لا يمكنك المباشرة وأنت مكلبش' });

        if (db.policejoins?.find(j => j.user === req.session.userId)) return res.json({ success: false, message: 'أنت مباشر بالفعل' });

        if (!db.policejoins) db.policejoins = [];
        db.policejoins.push({ user: req.session.userId, name: character.id.first, character: check.character });

        const pointsIndex = character.police_points?.findIndex(p => p.name === 'login');
        if (pointsIndex !== -1 && character.police_points) {
            character.police_points[pointsIndex].value = (character.police_points[pointsIndex].value || 0) + 4;
            userDoc.markModified(`characters.${check.character}.police_points`);
            await userDoc.save();
        }

        db.markModified('policejoins');
        await db.save();

        req.session.dutyTime = Date.now();

        res.json({ success: true, message: 'تم تسجيل المباشرة بنجاح', dutyTime: req.session.dutyTime });
    } catch (e) {
        console.error(e);
        res.json({ success: false, message: 'حدث خطأ' });
    }
});

app.post('/api/duty/logout', async (req, res) => {
    if (!req.session.userId) return res.json({ success: false, message: 'غير مسجل دخول' });
    try {
        const db = await guildBase.findOne({ guild: GUILD_ID });
        const index = db?.policejoins?.findIndex(j => j.user === req.session.userId);
        if (index === -1 || index === undefined) return res.json({ success: false, message: 'أنت لست مباشراً' });

        db.policejoins.splice(index, 1);
        db.markModified('policejoins');
        await db.save();

        req.session.dutyTime = null;

        res.json({ success: true, message: 'تم تسجيل الخروج بنجاح' });
         } catch (e) {
        console.error(e);
        res.json({ success: false, message: 'حدث خطأ' });
    }
});


app.get("/api/mdt/:idNumber", async (req, res) => {
    if (!req.session.userId) return res.json({ success: false, message: "غير مسجل دخول" });
    try {
        const db = await guildBase.findOne({ guild: GUILD_ID });
        const check = db?.joins?.find(j => j.user === req.session.userId);
        if (!check) return res.json({ success: false, message: "غير مخول" });
        const userDoc = await userBase.findOne({ guild: GUILD_ID, user: req.session.userId });
        const myChar = userDoc?.characters?.[check.character];
        if (!myChar || myChar.id?.job !== "police") return res.json({ success: false, message: "للشرطة فقط" });
        if (!db.policejoins?.find(j => j.user === req.session.userId)) return res.json({ success: false, message: "يجب تسجيل المباشرة أولاً" });
        const idNum = parseInt(req.params.idNumber);
        if (!idNum) return res.json({ success: false, message: "رقم غير صحيح" });
        const targetDoc = await userBase.findOne({ guild: GUILD_ID, "characters": { $elemMatch: { "id.number": idNum } } });
        if (!targetDoc) return res.json({ success: false, message: "لا يوجد هوية بهذا الرقم" });
        const charIdx = targetDoc.characters.findIndex(c => c?.id?.number === idNum);
        const c = targetDoc.characters[charIdx];
        const housesCount = Array.isArray(c.builds) ? c.builds.length : 0;
        res.json({
            success: true,
            character: {
                first: c.id?.first || "",
                last: c.id?.last || "",
                number: c.id?.number || 0,
                date: c.id?.date || "",
                place: c.id?.place || "",
                gender: c.id?.gender || "",
                job: c.id?.job || "citizen",
                mdt: c.id?.mdt || "",
                jailCount: c.jailCount || 0,
                inPrison: c.prison?.status || false,
                bank: c.bank || 0,
                housesCount
            }
        });
    } catch(e) {
        console.error(e);
        res.json({ success: false, message: "حدث خطأ" });
    }
});

// ===== PRIORITY =====
// نفس نصوص/ألوان الإمبيد الموجودة في priority.js (زر الديسكورد) بالضبط،
// حتى تكون النتيجة مطابقة سواء أرسلت من ديسكورد أو من الموقع.
function buildPriorityEmbed(type) {
    let embedDesc = "";
    const embedColor = "#ff0000";

    switch (type) {
        case "priority_0":
            embedDesc = `** - <:H_:1498348824043978782> Police Priority  (0)

1 - Kidnapping Citizen 
-# Status | <:Dt:1504574569263005727> 

2 - Kill Policeman
-# Status |  <:Dt:1504574569263005727> 

3 - Robbery Store 
-# Status |  <:Dt:1504574569263005727> 

4 - Robbery House 
-# Status |  <:Dt:1504574569263005727> 

5 - Robbery ATM 
-# Status |  <:Dt:1504574569263005727> 

6 - Kidnapping Policemen 
-# Status |  <:Dt:1504574569263005727> 

7 - Robbery Jewelry 
-# Status |  <:Dt:1504574569263005727> 

8 - Robbery Bank 
-# Status |  <:Dt:1504574569263005727> 

9 - Polito Bank 
-# Status | <:Dt:1504574569263005727>  **`;
            break;
        case "priority_4":
            embedDesc = `** - <:H_:1498348824043978782> Police Priority (4)

1 - Kidnapping Citizen 
-# Status | <:DT:1504575153789599995> 

2 - Kill Policeman
-# Status |  <:DT:1504575153789599995>  

3 - Robbery Store 
-# Status | <:DT:1504575153789599995>  

4 - Robbery House 
-# Status |  <:Dt:1504574569263005727> 

5 - Robbery ATM 
-# Status |  <:Dt:1504574569263005727> 

6 - Kidnapping Policemen 
-# Status |  <:Dt:1504574569263005727> 

7 - Robbery Jewelry 
-# Status |  <:Dt:1504574569263005727> 

8 - Robbery Bank 
-# Status |  <:Dt:1504574569263005727> 

9 - Polito Bank 
-# Status | <:Dt:1504574569263005727>  **`;
            break;
        case "priority_7":
            embedDesc = ` ** - <:H_:1498348824043978782>Police Priority (7)

1 - Kidnapping Citizen 
-# Status | <:DT:1504575153789599995> 

2 - Kill Policeman
-# Status |  <:DT:1504575153789599995>  

3 - Robbery Store 
-# Status | <:DT:1504575153789599995>  

4 - Robbery House 
-# Status |  <:DT:1504575153789599995> 

5 - Robbery ATM 
-# Status |  <:DT:1504575153789599995>  

6 - Kidnapping Policemen 
-# Status |  <:Dt:1504574569263005727> 

7 - Robbery Jewelry 
-# Status |  <:Dt:1504574569263005727> 

8 - Robbery Bank 
-# Status |  <:Dt:1504574569263005727> 

9 - Polito Bank 
-# Status | <:Dt:1504574569263005727>  **`;
            break;
        case "priority_10":
            embedDesc = `** - <:H_:1498348824043978782> Police Priority  (10)

1 - Kidnapping Citizen 
-# Status | <:DT:1504575153789599995> 

2 - Kill Policeman
-# Status |  <:DT:1504575153789599995>  

3 - Robbery Store 
-# Status | <:DT:1504575153789599995>  

4 - Robbery House 
-# Status |  <:DT:1504575153789599995> 

5 - Robbery ATM 
-# Status |  <:DT:1504575153789599995>  

6 - Kidnapping Policemen 
-# Status |  <:DT:1504575153789599995> 

7 - Robbery Jewelry 
-# Status |  <:Dt:1504574569263005727> 

8 - Robbery Bank 
-# Status |  <:Dt:1504574569263005727> 

9 - Polito Bank 
-# Status | <:Dt:1504574569263005727>  **`;
            break;
        case "priority_14":
            embedDesc = `** - <:H_:1498348824043978782> Police Priority  (14)

1 - Kidnapping Citizen 
-# Status | <:DT:1504575153789599995> 

2 - Kill Policeman
-# Status |  <:DT:1504575153789599995>  

3 - Robbery Store 
-# Status | <:DT:1504575153789599995>  

4 - Robbery House 
-# Status |  <:DT:1504575153789599995> 

5 - Robbery ATM 
-# Status |  <:DT:1504575153789599995>  

6 - Kidnapping Policemen 
-# Status |  <:Dt:1504574569263005727> 

7 - Robbery Jewelry 
-# Status |  <:DT:1504575153789599995> 

8 - Robbery Bank 
-# Status |  <:DT:1504575153789599995>  

9 - Polito Bank 
-# Status | <:DT:1504575153789599995>   **`;
            break;
        case "priority_code0":
            embedDesc = `**- <:H_:1498348824043978782> There is currently a security alert in the city. All citizens are urged to remain in their homes. Killing and kidnapping are permitted.**`;
            break;
        default:
            return null;
    }

    return new Discord.EmbedBuilder()
        .setTitle("Priority System")
        .setColor(embedColor)
        .setDescription(embedDesc);
}

// كولداون 15 دقيقة لكل يوزر/نوع أولوية، مطابق لكولداون زر الديسكورد
const webPriorityCooldowns = new Map();

app.post("/api/priority/send", async (req, res) => {
    if (!req.session.userId) return res.json({ success: false, message: "غير مسجل دخول" });

    try {
        const { type } = req.body;

        const allow = ["priority_0", "priority_4", "priority_7", "priority_10", "priority_14", "priority_code0"];
        if (!allow.includes(type)) return res.json({ success: false, message: "أولوية غير صحيحة" });

        const db = await guildBase.findOne({ guild: GUILD_ID });
        if (!db) return res.json({ success: false, message: "لم يتم إعداد السيرفر بعد" });

        const joinCheck = db.policejoins?.find(c => c.user === req.session.userId);
        if (!joinCheck) return res.json({ success: false, message: "يجب تسجيل المباشرة أولاً" });

        const dbUser = await userBase.findOne({ guild: GUILD_ID, user: req.session.userId });
        const character = dbUser?.characters?.[joinCheck.character];
        if (!character || character.id?.job !== "police") return res.json({ success: false, message: "شخصيتك الحالية ليست وظيفة عسكرية" });

        const now = Date.now();
        const cdKey = `${req.session.userId}_${type}`;
        const last = webPriorityCooldowns.get(cdKey) || 0;
        if (now - last < 15 * 60 * 1000) {
            const remaining = Math.ceil((15 * 60 * 1000 - (now - last)) / 1000 / 60);
            return res.json({ success: false, message: `يمكنك استخدام هذا الزر بعد ${remaining} دقيقة` });
        }

        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) return res.json({ success: false, message: "تعذر الوصول للسيرفر" });

        const priorityChannelId = typeof db.priority_channel === "string"
            ? db.priority_channel
            : db.priority_channel?.[type];
        if (!priorityChannelId) return res.json({ success: false, message: "لم يتم تحديد قناة الأولوية" });

        const channel = await guild.channels.fetch(priorityChannelId).catch(() => null);
        if (!channel) return res.json({ success: false, message: "تعذر العثور على قناة الأولوية" });

        const embed = buildPriorityEmbed(type);
        if (!embed) return res.json({ success: false, message: "أولوية غير صحيحة" });

        // نفس منطق البوت بالضبط: نبحث عن آخر رسالة إمبيد من البوت في القناة ونعدلها،
        // وإذا ما فيه نرسل وحدة جديدة (مو كل مرة رسالة جديدة)
        const messages = await channel.messages.fetch({ limit: 10 });
        const botMessage = messages.find(msg => msg.author.id === client.user.id && msg.embeds.length > 0);

        if (botMessage) {
            await botMessage.edit({ content: `|| @everyone ||`, embeds: [embed] });
        } else {
            await channel.send({ content: `|| @everyone ||`, embeds: [embed] });
        }

        if (db.priority_log) {
            const logCh = guild.channels.cache.get(db.priority_log);
            if (logCh) {
                const logEmbed = new Discord.EmbedBuilder()
                    .setTitle("Priority Log")
                    .setDescription(
                        `**<:DT:1429738321524822016> - قام العسكري | <@${req.session.userId}>\n` +
                        `<:DT:1429738321524822016> - الشخصية | ${character.id.first} ${character.id.last}\n` +
                        `<:DT:1429738321524822016> - رقم الكركتر | ${joinCheck.character + 1}\n` +
                        `<:DT:1429738321524822016> - نوع الأولوية | ${type.replace("priority_", "").toUpperCase()}\n` +
                        `<:DT:1429738321524822016> - المصدر | 🌐 الموقع\n` +
                        `<:DT:1429738321524822016> - الوقت | <t:${Math.floor(Date.now() / 1000)}:F>**`
                    );
                logCh.send({ embeds: [logEmbed] }).catch(() => {});
            }
        }

        webPriorityCooldowns.set(cdKey, now);

        return res.json({ success: true, message: "تم إرسال الأولوية بنجاح" });
    } catch (err) {
        console.error(err);
        return res.json({ success: false, message: `حدث خطأ: ${err.message || err.code || 'unknown'}` });
    }
});

app.get("*", (req, res) => {
    let html = fs.readFileSync(
        path.join(__dirname, "public", "index.html"),
        "utf8"
    );

    html = html
        .replace(/__LOGO_URL__/g, LOGO_URL)
        .replace(/__BG_URL__/g, BG_URL);

    res.send(html);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = startWebsite;

// إذا شغّلنا هذا الملف مباشرة (زي "node server.js" على Render)، نسوي تسجيل
// دخول للبوت بأنفسنا هنا، وبعدين نشغّل الموقع بـ client الجاهز.
// إذا صار require() لهذا الملف من ملف ثاني (بوت رئيسي يمرر client جاهز)،
// هذا الجزء ما يشتغل، وتقدر تستخدم startWebsite(client) بنفسك هناك.
if (require.main === module) {
    const { Client, GatewayIntentBits } = require('discord.js');

    if (!process.env.DISCORD_TOKEN) {
        console.error('❌ متغير البيئة DISCORD_TOKEN غير موجود. أضفه من Render > Environment.');
        process.exit(1);
    }

    const botClient = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
    });

    botClient.once('ready', () => {
        console.log(`✅ البوت دخل بحساب ${botClient.user.tag}`);
        startWebsite(botClient);
    });

    botClient.login(process.env.DISCORD_TOKEN).catch(e => {
        console.error('❌ فشل تسجيل دخول البوت:', e);
        process.exit(1);
    });
}
