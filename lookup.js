// lookup.js
// استخدام: node lookup.js
// يبحث عن مستخدم معيّن بقاعدة البيانات ويطبع بياناته كاملة بالكونسول
// (الشخصيات، الحقيبة، العقارات، وخزنة كل عقار)

require('dotenv').config();
const mongoose = require('mongoose');

// ===== عدل هذا الرقم لأي مستخدم تبي تفتش عليه =====
const TARGET_USER_ID = "1077635959811735582";
// ====================================================

// نفس الموديلات المستخدمة بالبوت (تأكد المسار صحيح حسب مكان تشغيلك للسكربت)
const userBase = require('./Database/User');
const guildBase = require('./Database/guildBase');

async function main() {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;

    if (!mongoUri) {
        console.log("❌ ما لقيت رابط قاعدة البيانات. تأكد من وجود متغير MONGO_URI أو MONGODB_URI بملف .env");
        process.exit(1);
    }

    await mongoose.connect(mongoUri);
    console.log("✅ تم الاتصال بقاعدة البيانات\n");

    // ابحث عن كل مستندات المستخدم (قد يكون له أكثر من سيرفر/guild)
    const userDocs = await userBase.find({ user: TARGET_USER_ID });

    if (!userDocs || userDocs.length === 0) {
        console.log(`❌ ما فيه أي بيانات للمستخدم ${TARGET_USER_ID}`);
        await mongoose.disconnect();
        return;
    }

    for (const doc of userDocs) {
        console.log("=".repeat(60));
        console.log(`📄 Document ID: ${doc._id}`);
        console.log(`🏠 Guild: ${doc.guild}`);
        console.log(`👤 User: ${doc.user}`);
        console.log("=".repeat(60));

        if (!Array.isArray(doc.characters) || doc.characters.length === 0) {
            console.log("لا يوجد شخصيات لهذا المستخدم.\n");
            continue;
        }

        doc.characters.forEach((char, charIndex) => {
            if (!char) return;

            console.log(`\n--- الشخصية [${charIndex}] ---`);
            console.log(`الاسم: ${char.id?.first || "?"} ${char.id?.last || "?"}`);
            console.log(`رقم الهوية: ${char.id?.number || "?"}`);
            console.log(`الكاش: ${char.cash} | البنك: ${char.bank}`);

            // الحقيبة
            console.log(`\n  📦 الحقيبة (inv):`);
            if (Array.isArray(char.inv) && char.inv.length > 0) {
                char.inv.forEach(item => {
                    console.log(`    - ${item.item || item.name} × ${item.count || item.amount || 1}`);
                });
            } else {
                console.log(`    (فاضية)`);
            }

            // العقارات (builds) وخزنة كل عقار (safe)
            console.log(`\n  🏠 العقارات (builds):`);
            if (Array.isArray(char.builds) && char.builds.length > 0) {
                char.builds.forEach((build, buildIndex) => {
                    if (!build) return;
                    console.log(`    [${buildIndex}] ${build.name || build.privateId || "بدون اسم"} (privateId: ${build.privateId})`);

                    if (Array.isArray(build.safe) && build.safe.length > 0) {
                        console.log(`      خزنة العقار:`);
                        build.safe.forEach(item => {
                            console.log(`        - ${item.item} × ${item.count}`);
                        });
                    } else {
                        console.log(`      خزنة العقار فاضية`);
                    }
                });
            } else {
                console.log(`    (لا يملك عقارات)`);
            }

            console.log("");
        });
    }

    await mongoose.disconnect();
    console.log("\n✅ انتهى البحث");
}

main().catch(err => {
    console.error("حدث خطأ:", err);
    process.exit(1);
});
