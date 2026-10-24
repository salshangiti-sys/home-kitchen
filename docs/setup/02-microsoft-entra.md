# دليل 2: تسجيل التطبيق في Microsoft Entra (لربط OneNote)

**الوقت:** نحو 20 دقيقة. **التكلفة:** التسجيل نفسه مجاني.
**المتطلب:** إنهاء دليل Supabase أولًا، لأن عنوان المشروع يدخل في الخطوة 3.

## لماذا هذا التسجيل؟

لا يصل أي تطبيق إلى OneNote إلا إذا سُجّل لدى Microsoft وحصل على موافقة صاحبة الحساب. منذ 31 مارس 2025 لم تعد Microsoft تسمح بالوصول إلى OneNote إلا بتسجيل دخول صاحبة الحساب نفسها. لذلك يسجّل التطبيق هنا، ثم تمنحه صاحبة الحساب الإذن مرة واحدة من داخل التطبيق.

## الخطوة 0: حساب Azure (إن لم يوجد)

تشترط Microsoft في دليلها الرسمي وجود **حساب Azure باشتراك نشط** لتسجيل التطبيقات، والحساب المجاني يكفي.

1. **فتح الرابط:** https://azure.microsoft.com/free ثم **Start free**.
2. **تسجيل الدخول بحساب Microsoft الشخصي نفسه** الذي فيه OneNote.
3. **إكمال التحقق:** رقم الجوال، وبطاقة للتحقق من الهوية فقط. **التحقق لا يعني خصمًا.**
4. **تنبيه مهم:** لا يُنشأ أي «مورد» (Resource) في Azure، ولا تُقبل أي ترقية مدفوعة. نحتاج «تسجيل التطبيق» فقط، وهو ضمن Microsoft Entra ID المجاني.

**نقطة سأتحقق منها معك:** بعد انتهاء الفترة المجانية لـ Azure (30 يومًا) قد تطلب Microsoft الترقية. المتوقع أن التطبيق المسجّل يستمر في العمل دون ترقية، لأن تسجيل التطبيقات لا يستهلك موارد مدفوعة. سنتأكد من ذلك عمليًا قبل الاعتماد عليه.

## الخطوة 1: تسجيل التطبيق

1. **فتح:** https://entra.microsoft.com وتسجيل الدخول بالحساب نفسه.
2. **الانتقال إلى:** **Entra ID ← App registrations ← New registration**.
3. **تعبئة الحقول:**
   - **Name:** `home-kitchen`
   - **Supported account types:** **Personal accounts only**
   - **Redirect URI:** يُترك فارغًا الآن، ويُضاف في الخطوة 3.
4. **Register**.
5. من صفحة **Overview** نسخ **Application (client) ID**. هذا المعرّف **ليس سريًا** ويمكن إرساله في المحادثة.

## الخطوة 2: الصلاحيات

1. **الانتقال إلى:** **API permissions ← Add a permission ← Microsoft Graph ← Delegated permissions**.
2. **البحث عن كل صلاحية وتحديدها:**

| الصلاحية | لماذا |
|---|---|
| `Notes.ReadWrite` | قراءة صفحات OneNote وإنشاؤها وتعديلها |
| `offline_access` | مزامنة في الخلفية دون تسجيل دخول متكرر (تحت **OpenId permissions**) |
| `Files.ReadWrite.AppFolder` | حفظ النسخ الاحتياطية في مجلد خاص بالتطبيق داخل OneDrive، **ولا يرى بقية ملفاتك** |
| `User.Read` | موجودة تلقائيًا، لمعرفة الحساب المرتبط |

3. **Add permissions**. لا حاجة لـ «Grant admin consent»، فالموافقة تتم عند أول ربط من داخل التطبيق.

**تنبيه صادق:** صلاحية `Notes.ReadWrite` تشمل **كل دفاتر الحساب**، فلا تتيح Microsoft صلاحية لدفتر واحد. الحماية في الكود: في المرحلة 0 **يرفض التطبيق الكتابة في أي دفتر غير الدفتر التجريبي** (قائمة سماح بمعرّف الدفتر)، ويُختبر ذلك آليًا.

## الخطوة 3: عنوان العودة (Redirect URI)

1. **الانتقال إلى:** **Authentication ← Add a platform ← Web**. يجب أن تكون **Web** وليس **Single-page application**، لأن تطبيقات المتصفح الصرفة تنتهي صلاحية دخولها كل 24 ساعة.
2. **Redirect URI:**
   ```
   https://<PROJECT-REF>.supabase.co/functions/v1/ms-oauth-callback
   ```
   حيث `<PROJECT-REF>` هو الجزء الأول من Project URL في Supabase. مثال: إن كان العنوان `https://abcd1234.supabase.co`، فالجزء هو `abcd1234`.
3. **Configure**.

## الخطوة 4: السر (Client secret)

1. **الانتقال إلى:** **Certificates & secrets ← Client secrets ← New client secret**.
2. **Description:** `supabase-dev`. **Expires:** **730 days (24 months)**، وسنضع تذكيرًا قبل انتهائه.
3. **Add**، ثم **نسخ عمود Value فورًا**. لا يظهر إلا مرة واحدة، وليس هو عمود **Secret ID**.
4. **حفظه مباشرة في Supabase، لا في المحادثة ولا في ملف:**
   - لوحة Supabase ← المشروع `home-kitchen-dev` ← **Edge Functions ← Secrets**
   - إضافة سر باسم `MS_CLIENT_SECRET` وقيمته المنسوخة، ثم **Save**.

إن ضاع السر أو انتشر بالخطأ: حذفه من صفحة **Certificates & secrets** وإنشاء سر جديد. لا ضرر في ذلك.

## ما يُرسل في المحادثة بعد الانتهاء

- **Application (client) ID** فقط.
- تأكيد أن `MS_CLIENT_SECRET` محفوظ في Supabase، **دون إرسال قيمته**.

## المراجع

- تسجيل التطبيق: https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app
- عمر رموز التحديث (24 ساعة للمتصفح و90 يومًا لغيره): https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens
- صلاحيات OneNote للحساب الشخصي: https://learn.microsoft.com/en-us/graph/api/onenote-list-pages
