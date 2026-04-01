async function checkModels() {
    try {
        console.log("⏳ جاري الاتصال بسيرفرات جوجل...");
        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=AIzaSyCaTJT0jEUCxImYCipuFjjp5cF5VJ28Rek');
        const data = await response.json();
        
        if (data.models) {
            console.log("✅ الموديلات الشغالة على المفتاح بتاعك هي:");
            data.models.forEach(m => {
                if (m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent')) {
                    console.log("👉 " + m.name.replace('models/', ''));
                }
            });
        } else {
            console.log("❌ خطأ من جوجل:", data);
        }
    } catch (err) {
        console.log("❌ خطأ في الاتصال:", err.message);
    }
}
checkModels();