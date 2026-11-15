/**
 * Web App: Attendance & Payroll Dashboard + Data Entry Form
 * แผ่นงานที่ใช้: "Data"
 * คอลัมน์: A=Date, B=Name, C=Leave Type, D=Select Shift, E=OT, F=Picture (URL)
 *
 * Routing:
 *   ?page=dashboard (ค่าเริ่มต้น) -> Index.html
 *   ?page=entry     -> Form.html (หน้ากรอกข้อมูล)
 */

const SHEET_NAME = 'Data';

const LEAVE_TYPES = [
  'Normal Working Day',
  'Day off',
  'Annual Leave',
  'Sick Leave',
  'Missing Work',
  'Holiday',
  'Vacation Leave',
  'Working on holidays'
];

const SHIFTS = ['Day', 'Night', 'off'];

/**
 * เรียกเมื่อเปิด Web App - เลือกหน้าตาม query parameter "page"
 */
function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) ? e.parameter.page : 'dashboard';

  let file = 'Index';
  let title = 'Attendance & Payroll Dashboard';

  if (page === 'entry' || page === 'form') {
    file = 'Form';
    title = 'บันทึกข้อมูล - Data Entry';
  }

  return HtmlService.createHtmlOutputFromFile(file)
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * คืน URL ของหน้าอื่นๆ ในเว็บแอป ให้ฝั่ง client ใช้สร้างลิงก์เชื่อมหน้า
 */
function getPageUrls() {
  const base = ScriptApp.getService().getUrl();
  return {
    dashboard: base,
    entry: base + '?page=entry'
  };
}

function getSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) {
    throw new Error('ไม่พบแผ่นงานชื่อ "' + SHEET_NAME + '"');
  }
  return sheet;
}

/**
 * ดึงข้อมูลทั้งหมดจากชีท "Data" (คอลัมน์ A-F) พร้อมข้อมูล meta
 * แต่ละแถวจะมี rowNumber (เลขแถวจริงในชีท) และ isoDate (yyyy-mm-dd) เพิ่มเข้ามา
 * เพื่อให้ฝั่งฟอร์มใช้อ้างอิงตอนแก้ไขข้อมูลได้
 */
function getReportData() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { rows: [], totalRows: 0, minDateDisplay: '', maxDateDisplay: '', names: [] };
  }

  const range = sheet.getRange(2, 1, lastRow - 1, 6); // A:F
  const values = range.getValues();

  const data = [];
  const nameSet = {};

  values.forEach(function (row, idx) {
    const rawDate = row[0];   // A
    const name = row[1];      // B
    const leaveType = row[2]; // C
    const shift = row[3];     // D
    const ot = row[4];        // E
    const picture = row[5];   // F

    const parsed = parseRowDate(rawDate);
    if (!parsed) return; // ข้ามแถวที่อ่านวันที่ไม่ได้

    if (name) nameSet[name] = true;

    data.push({
      rowNumber: idx + 2, // แถวจริงในชีท (แถว 1 คือ header)
      dateKey: parsed.dateKey,
      dateDisplay: parsed.display,
      isoDate: parsed.isoDate,
      dayOfWeek: parsed.dayOfWeek,
      name: name || '',
      leaveType: leaveType || '',
      shift: shift || '',
      ot: (typeof ot === 'number') ? ot : (parseFloat(ot) || 0),
      picture: picture || ''
    });
  });

  data.sort(function (a, b) { return a.dateKey - b.dateKey; });

  const totalRows = data.length;
  return {
    rows: data,
    totalRows: totalRows,
    minDateDisplay: totalRows ? data[0].dateDisplay : '',
    maxDateDisplay: totalRows ? data[totalRows - 1].dateDisplay : '',
    names: Object.keys(nameSet).sort()
  };
}

/** คงไว้เผื่อโค้ดเดิมเรียกใช้ */
function getSheetData() {
  return getReportData().rows;
}

function getLeaveTypes() { return LEAVE_TYPES; }
function getShifts() { return SHIFTS; }

/**
 * รายชื่อพนักงานที่เคยมีข้อมูลอยู่แล้วในชีท (ไม่ซ้ำ) สำหรับ dropdown ในฟอร์ม
 */
function getEmployeeNames() {
  return getReportData().names;
}

/**
 * ข้อมูลตั้งต้นสำหรับหน้าฟอร์ม เรียกครั้งเดียวลดจำนวน round-trip
 */
function getFormInitData() {
  const report = getReportData();
  return {
    names: report.names,
    leaveTypes: LEAVE_TYPES,
    shifts: SHIFTS
  };
}

/**
 * รายการข้อมูลย้อนหลังของพนักงานคนหนึ่ง (เรียงล่าสุดก่อน) สำหรับหน้า "แก้ไขข้อมูล"
 * จำกัดไว้ 60 รายการล่าสุดเพื่อไม่ให้โหลดหนักเกินไป
 */
function getMyEntries(name) {
  if (!name) return [];
  const report = getReportData();
  return report.rows
    .filter(function (r) { return r.name === name; })
    .sort(function (a, b) { return b.dateKey - a.dateKey; })
    .slice(0, 60);
}

/**
 * บันทึกข้อมูล 1 แถวลงชีท "Data"
 * - ถ้าไม่ส่ง entry.rowNumber มา -> เพิ่มแถวใหม่ (เหมือนเดิม)
 * - ถ้าส่ง entry.rowNumber มา -> แก้ไขแถวเดิมแทนการเพิ่มแถวใหม่ (ใช้ตอนแก้ไขข้อมูลที่กรอกผิด)
 *
 * entry = {
 *   date: 'yyyy-mm-dd' (ค.ศ. จาก input type=date),
 *   name, leaveType, shift, ot,
 *   pictureBase64, pictureFileName, pictureMimeType  (ไม่บังคับ - แนบเมื่อมีการเลือกรูปใหม่),
 *   existingPicture (ไม่บังคับ - URL รูปเดิม ใช้เมื่อแก้ไขแล้วไม่ได้เปลี่ยนรูป),
 *   rowNumber (ไม่บังคับ - เลขแถวในชีทที่จะแก้ไข)
 * }
 */
function submitEntry(entry) {
  if (!entry || !entry.date || !entry.name || !entry.leaveType || !entry.shift) {
    throw new Error('กรุณากรอกข้อมูลให้ครบ: Date, Name, Leave Type, Select Shift');
  }

  const parts = entry.date.split('-'); // [yyyy, mm, dd] ค.ศ.
  if (parts.length !== 3) {
    throw new Error('รูปแบบวันที่ไม่ถูกต้อง');
  }
  const yyyyCE = parseInt(parts[0], 10);
  const mm = parts[1];
  const dd = parts[2];
  const yyyyBE = yyyyCE + 543;

  // เก็บวันที่เป็นข้อความรูปแบบ dd/mm/yyyy (พ.ศ.) ให้ตรงกับข้อมูลเดิมในชีท
  const dateForSheet = dd + '/' + mm + '/' + yyyyBE;

  // เริ่มต้นด้วยรูปเดิม (ถ้ามีการส่งมาตอนแก้ไข) แล้วค่อยเขียนทับถ้ามีการอัปโหลดรูปใหม่
  let pictureUrl = entry.existingPicture || '';
  if (entry.pictureBase64) {
    try {
      const folder = getOrCreatePictureFolder_();
      const bytes = Utilities.base64Decode(entry.pictureBase64);
      const fileName = entry.pictureFileName || ('photo_' + new Date().getTime() + '.jpg');
      const mime = entry.pictureMimeType || 'image/jpeg';
      const blob = Utilities.newBlob(bytes, mime, fileName);
      const file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      pictureUrl = file.getUrl();
    } catch (err) {
      // ถ้าอัปโหลดรูปไม่สำเร็จ ให้บันทึกข้อมูลอื่นต่อได้ตามปกติ โดยคงรูปเดิม (หรือว่างไว้) ตามเดิม
    }
  }

  const sheet = getSheet_();
  const rowValues = [
    dateForSheet,
    entry.name,
    entry.leaveType,
    entry.shift,
    Number(entry.ot) || 0,
    pictureUrl
  ];

  if (entry.rowNumber) {
    const rowNum = parseInt(entry.rowNumber, 10);
    const lastRow = sheet.getLastRow();
    if (!rowNum || rowNum < 2 || rowNum > lastRow) {
      throw new Error('ไม่พบแถวข้อมูลที่จะแก้ไข กรุณาลองใหม่อีกครั้ง');
    }
    sheet.getRange(rowNum, 1, 1, 6).setValues([rowValues]);
    return { success: true, dateDisplay: dateForSheet, updated: true, rowNumber: rowNum };
  }

  sheet.appendRow(rowValues);
  return { success: true, dateDisplay: dateForSheet, updated: false };
}

function getOrCreatePictureFolder_() {
  const folderName = 'Data Entry App - Pictures';
  const folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(folderName);
}

/**
 * แปลงค่าวันที่จากคอลัมน์ A ให้เป็น dateKey (ค.ศ.), ข้อความแสดงผล (พ.ศ.) และชื่อวัน
 * รองรับทั้ง Date object และ text แบบ dd/MM/yyyy
 */
function parseRowDate(rawDate) {
  let day, month, yearRaw;

  if (Object.prototype.toString.call(rawDate) === '[object Date]' && !isNaN(rawDate)) {
    day = rawDate.getDate();
    month = rawDate.getMonth() + 1;
    yearRaw = rawDate.getFullYear();
  } else if (typeof rawDate === 'string' && (rawDate.indexOf('/') > -1 || rawDate.indexOf('-') > -1)) {
    const sep = rawDate.indexOf('/') > -1 ? '/' : '-';
    const parts = rawDate.trim().split(sep);
    if (parts.length !== 3) return null;
    day = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    yearRaw = parseInt(parts[2], 10);
  } else {
    return null;
  }

  if (!yearRaw || !month || !day || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  let yearBE, yearCE;
  if (yearRaw > 2400) {
    yearBE = yearRaw;
    yearCE = yearRaw - 543;
  } else {
    yearCE = yearRaw;
    yearBE = yearRaw + 543;
  }

  const dd = ('0' + day).slice(-2);
  const mm = ('0' + month).slice(-2);

  const thaiDays = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  const dateObj = new Date(yearCE, month - 1, day);
  const dayOfWeek = thaiDays[dateObj.getDay()];

  return {
    dateKey: yearCE * 10000 + month * 100 + day,
    display: dd + '/' + mm + '/' + yearBE,
    isoDate: yearCE + '-' + mm + '-' + dd,
    dayOfWeek: dayOfWeek
  };
}