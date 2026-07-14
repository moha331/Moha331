const express = require('express');
const session = require('express-session');
const axios = require('axios');
const mongoose = require('mongoose');
const path = require('path');

const app = express();

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


app.get("/api/debug", async (req, res) => {
    if (!req.session.userId) return res.json({ error: "سجل دخول أول" });
    try {
        const db = await guildBase.findOne({ guild: GUILD_ID });
        const check = db?.joins?.find(j => j.user === req.session.userId);
        const userDoc = await userBase.findOne({ guild: GUILD_ID, user: req.session.userId });
        const character = userDoc?.characters?.[check?.character];
        res.json({
            userId: req.session.userId,
            foundInJoins: !!check,
            characterIndex: check?.character,
            job: character?.id?.job,
            accepted: character?.id?.accepted,
            totalJoins: db?.joins?.length
        });
    } catch(e) { res.json({ error: e.message }); }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
EOF
echo "server done"
