const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.json({ limit: '50mb' }));

// ==========================================
// 1. إعداد الذكاء الاصطناعي (Gemini 2.5 Flash) 🧠
// ==========================================
const genAI = new GoogleGenerativeAI("AIzaSyCaTJT0jEUCxImYCipuFjjp5cF5VJ28Rek");
const aiModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// ==========================================
// 2. الاتصال بقاعدة البيانات (MongoDB)
// ==========================================
const mongoURI = 'mongodb://shefo:25800852@ac-osawphu-shard-00-00.sbl4a0r.mongodb.net:27017,ac-osawphu-shard-00-01.sbl4a0r.mongodb.net:27017,ac-osawphu-shard-00-02.sbl4a0r.mongodb.net:27017/historya_db?ssl=true&replicaSet=atlas-bpgofo-shard-0&authSource=admin&appName=Historya';

mongoose.connect(mongoURI, { serverSelectionTimeoutMS: 30000, socketTimeoutMS: 45000 })
  .then(() => { console.log('✅ تم الاتصال بخزنة البيانات (MongoDB) بنجاح!'); })
  .catch((err) => { console.error('❌ خطأ في الاتصال:', err.message); });

const dataSchema = new mongoose.Schema({
    systemId: { type: String, default: 'historya_main' },
    students: Array, groups: Array, sessions: Array,
    exams: Array, homework: Array, attendanceData: Object,
    examResults: Object, homeworkSubmissions: Object, counters: Object
});
const SystemData = mongoose.model('SystemData', dataSchema);

// ==========================================
// 3. مسارات المزامنة السحابية
// ==========================================
app.post('/api/save-cloud', async (req, res) => {
    try {
        await SystemData.findOneAndUpdate({ systemId: 'historya_main' }, req.body, { upsert: true });
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.get('/api/load-cloud', async (req, res) => {
    try {
        const data = await SystemData.findOne({ systemId: 'historya_main' });
        res.json({ success: true, data: data });
    } catch (error) { res.status(500).json({ success: false }); }
});

// ==========================================
// 4. إعداد الواتساب بوت (النسخة المستقرة)
// ==========================================
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const client = new Client({
    authStrategy: new LocalAuth(),
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    },
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--disable-gpu']
    }
});

let isReady = false;
client.on('qr', (qr) => { console.log('امسح الكود دا بالموبايل:'); qrcode.generate(qr, { small: true }); });
client.on('ready', () => { console.log('✅ تم ربط الواتساب بنجاح! السكرتير الذكي جاهز.'); isReady = true; });

// ==========================================
// 5. الرد الآلي + السكرتير الذكي + الذاكرة الحية 🤖
// ==========================================
function normalizeArabicName(name) {
    if (!name) return "";
    return name.toString().trim().replace(/\s+/g, ' ').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[\u064B-\u065F]/g, ''); 
}

const userStates = {}; 

// 👇👇 تم تسجيل رقمك كإدمن هنا بنجاح 👇👇
const adminNumber = '201288599712@c.us'; 

client.on('message', async (msg) => {
    if (msg.from === 'status@broadcast' || msg.author) return;

    const text = msg.body.trim();
    const sender = msg.from;

    try {
        const systemData = await SystemData.findOne({ systemId: 'historya_main' });
        if (!systemData) return;

        // 🟢 استقبال التنبيهات من المدير (من رقمك فقط)
        if (sender === adminNumber && text.startsWith('تنبيه')) {
            const newNotice = text.replace(/^تنبيه:?\s*/, '').trim();
            await SystemData.findOneAndUpdate(
                { systemId: 'historya_main' },
                { $set: { "counters.lastNotice": newNotice } },
                { upsert: true }
            );
            await msg.reply(`✅ علم وينفذ يا مستر!\nتم حفظ التنبيه الجديد:\n"${newNotice}"\n\nأي طالب هيسأل دلوقتي هبلغه فوراً.`);
            return;
        }

        // --- استعلام الدرجات بالرقم ---
        if (userStates[sender] && userStates[sender].step === 'auth') {
            const student = userStates[sender].student;
            if (text === 'إلغاء') { delete userStates[sender]; msg.reply('تم إلغاء الاستعلام. 🚫'); return; }

            if (text === student.phone || text === student.parentPhone) {
                let groupName = 'غير محدد'; let targetGroupId = null;
                if (systemData.groups) {
                    const foundGroup = systemData.groups.find(g => g.students && g.students.some(s => s.id == student.id));
                    if (foundGroup) { groupName = foundGroup.name; targetGroupId = foundGroup.id; }
                }

                let attendanceMsg = `\n📅 *سجل الحضور والغياب:*\n`;
                let hasAtt = false;
                if (systemData.sessions && targetGroupId) {
                    const studentSessions = systemData.sessions.filter(s => s.groupId == targetGroupId);
                    if (studentSessions.length > 0) {
                        hasAtt = true;
                        studentSessions.forEach(session => {
                            const status = systemData.attendanceData?.[session.id]?.[student.id];
                            let emoji = '⚪', statusAr = 'لم يُسجل';
                            if (status === 'present') { statusAr = 'حاضر'; emoji = '🟢'; }
                            else if (status === 'absent') { statusAr = 'غائب'; emoji = '🔴'; }
                            else if (status === 'late') { statusAr = 'متأخر'; emoji = '🟡'; }
                            attendanceMsg += `${emoji} ${session.name || 'حصة'}: *${statusAr}*\n`;
                        });
                    }
                }
                if (!hasAtt) attendanceMsg += `لا توجد حصص مسجلة.\n`;

                let hwMsg = `\n📚 *سجل الواجبات:*\n`;
                let hasHw = false;
                if (systemData.homework && targetGroupId) {
                    const studentHomeworks = systemData.homework.filter(h => h.groupId == targetGroupId);
                    if (studentHomeworks.length > 0) {
                        hasHw = true;
                        studentHomeworks.forEach(hw => {
                            const isSubmitted = systemData.homeworkSubmissions?.[hw.id]?.[student.id];
                            if (isSubmitted) hwMsg += `✅ ${hw.name}: *مُسلم*\n`;
                            else hwMsg += `❌ ${hw.name}: *غير مُسلم*\n`;
                        });
                    }
                }
                if (!hasHw) hwMsg += `لا توجد واجبات مسجلة.\n`;

                let examsMsg = `\n📝 *سجل الامتحانات:*\n`;
                let hasExams = false;
                if (systemData.exams && targetGroupId) {
                    const studentExams = systemData.exams.filter(e => e.groupId == targetGroupId);
                    if (studentExams.length > 0) {
                        hasExams = true;
                        studentExams.forEach(exam => {
                            const score = systemData.examResults?.[exam.id]?.[student.id];
                            if (score !== undefined && score !== null && score !== "") {
                                examsMsg += `🌟 ${exam.name}: *${score} من ${exam.maxScore}*\n`;
                            } else { examsMsg += `⚪ ${exam.name}: *لم يمتحن*\n`; }
                        });
                    }
                }
                if (!hasExams) examsMsg += `لا توجد امتحانات مسجلة.\n`;

                let replyMessage = `✅ *تم التحقق بنجاح!*\n\n👨‍🎓 *كشف حساب الطالب*\n===================\n👤 *الاسم:* ${student.name}\n🔢 *الكود:* ${student.id}\n🏷️ *المجموعة:* ${groupName}\n===================\n${attendanceMsg}===================\n${hwMsg}===================\n${examsMsg}===================\n`;
                await msg.reply(replyMessage);
                delete userStates[sender];
            } else {
                userStates[sender].attempts += 1;
                if (userStates[sender].attempts >= 3) { msg.reply('❌ تجاوزت الحد الأقصى للمحاولات. تم الإلغاء.'); delete userStates[sender]; } 
                else { msg.reply('❌ الرقم غير صحيح! يرجى إدخاله مجدداً.'); }
            }
            return; 
        }

        // --- البحث عن طالب ---
        const students = systemData.students || [];
        const normalizedInput = normalizeArabicName(text);
        let matchedStudent = null;

        const numberMatch = text.match(/\d+/);
        if (numberMatch && (text.includes('كود') || text.includes('تقرير') || numberMatch[0] === text.trim())) {
            matchedStudent = students.find(s => s.id.toString() === numberMatch[0]);
        }

        if (!matchedStudent) {
            const cleanName = normalizedInput.replace(/(تقرير|عن|طالب|استعلام|كود|نتيجة|درجات|بتاع|يا|مستر|مس)/g, '').trim();
            if (cleanName.length >= 3) { 
                matchedStudent = students.find(s => normalizeArabicName(s.name) === cleanName);
                if (!matchedStudent && cleanName.split(' ').length >= 2) {
                    matchedStudent = students.find(s => normalizeArabicName(s.name).includes(cleanName));
                }
            }
        }

        if (matchedStudent) {
            userStates[sender] = { step: 'auth', student: matchedStudent, attempts: 0 };
            await msg.reply(`مرحباً بك..\nتم العثور على بيانات الطالب: *${matchedStudent.name}*\n\n🔒 *يرجى إرسال رقم الهاتف المسجل للتحقق.*`);
            return; 
        }

        // 🤖 السكرتير الذكي + الذاكرة الحية (للأسئلة العادية)
        if (!matchedStudent && text.length > 2) {
            const liveNotice = systemData.counters?.lastNotice || "لا توجد تنبيهات طارئة حالياً.";
            
            const systemPrompt = `أنت سكرتير آلي محترف، ودود، ولبق تعمل لدى "مستر هيستوريا" (مدرس تاريخ).
دورك هو الرد على الطلاب وأولياء الأمور بأسلوب جذاب، منظم، ومريح للعين باستخدام الإيموجيز (مثل 🏛️، 🕒، 📚، ✨).
لا تقم بنسخ المعلومات ولصقها، بل أعد صياغتها بطريقة احترافية في نقاط واضحة.

📢 **تنبيه هام وعاجل (له الأولوية القصوى في الرد إذا سأل الطالب عن مواعيد اليوم أو الحصص):** ${liveNotice}

المعلومات الثابتة التي يجب الالتزام بها:
- أماكن التواجد: سنتر الأوائل (المنوات)، سنتر دريم (المنيل)، سنتر الفضل (الحوامدية).
- أسعار الحصص: الأول الثانوي (30ج)، الثاني الثانوي (35ج)، الثالث الثانوي (50ج).
- مواعيد الأول الثانوي: الثلاثاء 5م والأربعاء 5م (الأوائل)، الأحد 3م (دريم)، الخميس 1م (الفضل).
- مواعيد الثاني الثانوي: الاثنين 5م (الأوائل)، الأحد 5م (دريم)، الخميس 3م (الفضل).
- مواعيد الثالث الثانوي: الثلاثاء 2م (الأوائل)، السبت 5م (الفضل).
- الاستعلام عن الدرجات: إذا طلب الطالب درجته قل له 'برجاء كتابة اسمك أو الكود'.

سؤال الطالب: "${text}"
رد بناءً على التنبيه العاجل أولاً (إذا كان له علاقة بالسؤال)، ثم استخدم المعلومات الثابتة للإجابة.`;

            const chatResult = await aiModel.generateContent(systemPrompt);
            const aiResponse = chatResult.response.text();
            await msg.reply(aiResponse);
        }

    } catch (error) { console.error('❌ خطأ في محرك البحث أو الذكاء الاصطناعي:', error); }
});

client.initialize();

// ==========================================
// 6. مسارات الإرسال للواتساب (التنبيهات العادية)
// ==========================================
function formatEgyptianNumber(number) {
    let formatted = number.trim();
    if (formatted.startsWith('0')) formatted = formatted.substring(1);
    return `20${formatted}@c.us`; // 👈 رجعتها عشان تبعت للطلاب صح
}

app.post('/send-attendance', async (req, res) => {
    if (!isReady) return res.status(503).json({ error: 'الواتساب غير متصل بعد' });
    const { sessionName, attendanceRecords } = req.body;
    let successCount = 0, failCount = 0;

    for (const record of attendanceRecords) {
        try {
            const statusText = record.status === 'present' ? 'حاضر ✅' : record.status === 'absent' ? 'غائب ❌' : 'متأخر ⏳';
            const message = `إشعار من إدارة *هيستوريا* 🏛️\n\nنحيطكم علماً بأن حالة الطالب/ة: *${record.studentName}*\nفي حصة (${sessionName}) هي: *${statusText}*\n\nتمنياتنا بالتوفيق!`;

            if (record.parentPhone) { await client.sendMessage(formatEgyptianNumber(record.parentPhone), message); successCount++; await new Promise(r => setTimeout(r, 1500)); }
            if (record.studentPhone) { await client.sendMessage(formatEgyptianNumber(record.studentPhone), message); successCount++; await new Promise(r => setTimeout(r, 1500)); }
        } catch (error) { failCount++; }
    }
    res.json({ message: 'تم الانتهاء', successCount, failCount });
});

app.post('/send-full-report', async (req, res) => {
    if (!isReady) return res.status(503).json({ error: 'الواتساب غير متصل بعد' });
    const { sessionName, homeworkName, examName, examMaxScore, records } = req.body;
    let successCount = 0, failCount = 0;

    for (const record of records) {
        try {
            let message = `إشعار من إدارة *هيستوريا* 🏛️\n\nتقرير الطالب/ة: *${record.studentName}*\nالحصة: *${sessionName}*\n-------------------\n`;
            if (record.attendanceStatus) {
                const statusText = record.attendanceStatus === 'present' ? 'حاضر ✅' : record.attendanceStatus === 'absent' ? 'غائب ❌' : 'متأخر ⏳';
                message += `📍 *الحضور:* ${statusText}\n`;
            } else { message += `📍 *الحضور:* لم يُسجل ⚠️\n`; }
            
            if (homeworkName) {
                const hwStatus = record.homeworkSubmitted ? 'مُسلم ✅' : 'غير مُسلم ❌';
                message += `📝 *الواجب:* ${hwStatus} (${homeworkName})\n`;
            }
            if (examName) {
                const exScore = (record.examScore !== undefined && record.examScore !== '') ? record.examScore : 'غ/م';
                message += `🎯 *الامتحان:* ${exScore} / ${examMaxScore} (${examName})\n`;
            }
            message += `\nتمنياتنا بدوام التوفيق! 🌟`;

            if (record.parentPhone) { await client.sendMessage(formatEgyptianNumber(record.parentPhone), message); successCount++; await new Promise(r => setTimeout(r, 1500)); }
            if (record.studentPhone) { await client.sendMessage(formatEgyptianNumber(record.studentPhone), message); successCount++; await new Promise(r => setTimeout(r, 1500)); }
        } catch (error) { failCount++; }
    }
    res.json({ message: 'تم الانتهاء', successCount, failCount });
});

app.post('/send-custom-notification', async (req, res) => {
    if (!isReady) return res.status(503).json({ error: 'الواتساب غير متصل بعد' });
    const { message, students } = req.body;
    let successCount = 0, failCount = 0, batchCount = 0;

    const safeSend = async (phone, text) => {
        if (!phone) return;
        try {
            const formattedPhone = formatEgyptianNumber(phone);
            if (await client.isRegisteredUser(formattedPhone)) {
                await client.sendMessage(formattedPhone, text);
                successCount++; batchCount++;
                await new Promise(r => setTimeout(r, Math.floor(Math.random() * 5000) + 10000));
                if (batchCount >= 10) { await new Promise(r => setTimeout(r, 30000)); batchCount = 0; }
            } else { failCount++; }
        } catch (error) { failCount++; }
    };

    for (const student of students) {
        let personalizedMessage = message
            .replace(/\[اسم_الطالب\]/g, student.name)
            .replace(/\[كود_الطالب\]/g, student.code)
            .replace(/\[الصف\]/g, student.grade)
            .replace(/\[رقم_الهاتف\]/g, student.phone || 'غير مسجل')
            .replace(/\[رقم_ولي_الأمر\]/g, student.parentPhoneNum || 'غير مسجل');

        const finalMessage = `إشعار هام من إدارة *هيستوريا* 🏛️\n\n${personalizedMessage}`;
        if (student.parentPhone) await safeSend(student.parentPhone, finalMessage);
        if (student.studentPhone) await safeSend(student.studentPhone, finalMessage);
    }
    res.json({ success: true, successCount, failCount });
});

const PORT = 3000;
app.listen(PORT, () => { console.log(`🚀 السيرفر شغال على البورت ${PORT}`); });