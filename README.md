# Attendance & Payroll (SQLite + GitHub Pages)

ย้ายจาก Google Sheet + Apps Script มาเป็นเว็บ static บน GitHub Pages
ข้อมูลเก็บในไฟล์ SQLite (`data/money.sqlite`) หน้าตาเหมือนเดิมทุกอย่าง

| ไฟล์ | หน้าที่ |
|---|---|
| `index.html` | Dashboard (เดิม `Index.html`) |
| `form.html` | หน้ากรอก/แก้ไขข้อมูล (เดิม `Form.html`) |
| `js/db.js` | แทน `Code.gs` — อ่าน/เขียน SQLite ในเบราว์เซอร์ด้วย sql.js และมี `google.script.run` shim |
| `data/money.sqlite` | ฐานข้อมูล (ตาราง `entries`) |
| `data/schema.sql` | โครงสร้างตาราง |
| `tools/xlsx_to_sqlite.py` | แปลง Excel ที่ export จาก Google Sheet เป็น SQLite |
| `tools/serve.py` | รันบนเครื่องพร้อมบันทึกข้อมูลลงไฟล์ได้ |
| `legacy-gas/` | โค้ด Apps Script เดิม (เก็บไว้อ้างอิง) |

## การบันทึกข้อมูลบน GitHub Pages

GitHub Pages เป็นเว็บ static เขียนไฟล์เองไม่ได้ ปุ่ม Save จึงแก้ไฟล์ SQLite ในเบราว์เซอร์
แล้ว **commit กลับเข้ารีโปผ่าน GitHub API** — ต้องตั้งค่าครั้งแรกที่เมนู ⚙️ ตั้งค่า:

1. สร้าง [Fine-grained token](https://github.com/settings/personal-access-tokens/new)
   เลือกเฉพาะรีโปนี้ → Permissions → **Contents: Read and write**
2. เปิดเว็บ → ⚙️ ตั้งค่า → ใส่ Owner / Repository / Branch / Token → ทดสอบการเชื่อมต่อ → บันทึก

Token เก็บใน localStorage ของเบราว์เซอร์เครื่องนั้นเท่านั้น
เมื่อมี Token เว็บจะอ่านข้อมูลผ่าน API ทำให้เห็นข้อมูลใหม่ทันที (ไม่ต้องรอ Pages deploy ~1 นาที)
รูปที่แนบจะถูก commit ไว้ใน `pictures/`

> ⚠️ ถ้ารีโปเป็น public ข้อมูลเงินเดือน/การทำงานทั้งหมดจะเปิดให้ทุกคนดูได้
> (GitHub Pages จากรีโป private ต้องใช้แพ็กเกจ GitHub Pro ขึ้นไป)

## รันบนเครื่อง

```bash
python tools/serve.py
```

เปิด http://localhost:8000 — บันทึกลงไฟล์ `data/money.sqlite` ในเครื่องโดยตรง ไม่ต้องใช้ Token

## แปลงข้อมูลจาก Google Sheet ใหม่

ดาวน์โหลดชีทเป็น .xlsx แล้วรัน (ต้องมี `pip install openpyxl`; **เขียนทับ** ฐานข้อมูลเดิม):

```bash
python tools/xlsx_to_sqlite.py "Data Money.xlsx"
```

วันที่ในชีทเป็นปี พ.ศ. จะถูกเก็บเป็น `yyyy-mm-dd` ค.ศ. ในฐานข้อมูล และแสดงผลเป็น พ.ศ. เหมือนเดิม
