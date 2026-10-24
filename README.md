# مطبخ البيت (home-kitchen)

تطبيق شخصي لإدارة الطبخ المنزلي: مكتبة وصفات مرتبطة بـ OneNote، وتخطيط أسبوعي للوجبات، وقائمة مقاضي موحدة، ومهام تجهيز، ومفرزنات، ولانش بوكس.

## الحالة

**المرحلة 0 (الأساس وتجربة مزامنة OneNote).** الموجود الآن هيكل التطبيق فقط: الخط، واتجاه RTL، والوضعان الفاتح والداكن. لا توجد وصفات ولا بيانات ولا مزامنة بعد.

التحليل والمعمارية والقرارات المعتمدة في [docs/01-analysis-and-architecture.md](docs/01-analysis-and-architecture.md).

## أدلة الإعداد (بالترتيب)

1. [مشروع Supabase](docs/setup/01-supabase.md)
2. [تسجيل التطبيق في Microsoft Entra](docs/setup/02-microsoft-entra.md)
3. [الدفتر التجريبي في OneNote](docs/setup/03-test-notebook.md)

## التشغيل على الجهاز

يحتاج Node.js 22، والإصدار محدد في `.nvmrc`.

```bash
nvm use
npm install
npm run dev
```

ثم فتح http://localhost:5173

| الأمر | الوظيفة |
|---|---|
| `npm test` | تشغيل الاختبارات |
| `npm run typecheck` | فحص الأنواع |
| `npm run build` | بناء نسخة الإنتاج في `dist/` |

## الخط

IBM Plex Sans Arabic 1.1.0، أربعة أوزان (400 و500 و600 و700) بصيغة woff2 من الإصدار الرسمي `@ibm/plex-sans-arabic@1.1.0`. الملفات مطابقة لمستودع IBM وغير معدّلة، والترخيص SIL Open Font License 1.1 في `public/fonts/ibm-plex-sans-arabic/LICENSE.txt`.

## قواعد المستودع

- لا أسرار ولا مفاتيح API في المستودع. الإعدادات السرية تُحفظ في ملفات `.env` المستثناة من Git، أو في إعدادات الخادم.
- لا تعديل على دفتر OneNote الحقيقي قبل نجاح التجربة على دفتر تجريبي والموافقة الصريحة.
