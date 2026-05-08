/**
 * FSL鹿児島県ICT支援スケジュールシステム - サーバーサイド
 */

// ===== シート名定数 =====
var SHEET_USERS = 'ユーザー';
var SHEET_CANDIDATES = '候補日';
var SHEET_SETTINGS = 'システム設定';
var SHEET_SA = 'SAマスタ';
var SHEET_STAFF = '支援員マスタ';
var SHEET_HOLIDAYS = '全体休日';
var SHEET_MEETINGS = '定例会日';
var SHEET_STAFF_OFF = '支援員休日';
var SHEET_SCHOOLS = '学校マスタ';
var SHEET_SCHEDULE = 'スケジュール';
var SHEET_PRIORITY = '優先スコア';

// ===== エントリポイント =====

function doGet(e) {
  var realEmail = Session.getActiveUser().getEmail();
  var params = (e && e.parameter) || {};
  var baseUrl = ScriptApp.getService().getUrl();
  var settings = getSystemSettings_();

  // ロール自動判定
  var realRole = detectRole_(realEmail);

  // SAのなりすまし機能: SAユーザーがrole・impersonateパラメータで他画面を閲覧
  if (realRole === 'sa' && params.role && params.impersonate) {
    var impEmail = params.impersonate;
    switch (params.role) {
      case 'staff':
        return serveStaff_(impEmail, settings, baseUrl);
      case 'board':
        return serveBoard_(params, baseUrl);
      case 'teacher':
        return serveTeacher_(impEmail, settings, baseUrl);
      case 'sa':
        return serveSA_(impEmail, settings, baseUrl);
      default:
        return serveTeacher_(impEmail, settings, baseUrl);
    }
  }

  // 各画面へルーティング
  switch (realRole) {
    case 'sa':
      return serveSA_(realEmail, settings, baseUrl);
    case 'staff':
      return serveStaff_(realEmail, settings, baseUrl);
    case 'teacher':
    default:
      return serveTeacher_(realEmail, settings, baseUrl);
  }
}

// ===== 画面ルーティング =====

function serveHub_(baseUrl, email, devMode) {
  var template = HtmlService.createTemplateFromFile('hub');
  template.baseUrl = baseUrl;
  template.email = email;
  template.accountList = JSON.stringify(getAccountList_());
  return template.evaluate()
    .setTitle('FSL鹿児島県ICT支援スケジュールシステム')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function serveTeacher_(email, settings, baseUrl) {
  var userData = getUserByEmail_(email);

  if (!userData) {
    var schools = getAllSchools_();
    var template = HtmlService.createTemplateFromFile('register');
    template.email = email;
    template.schools = JSON.stringify(schools);
    template.baseUrl = baseUrl;
    return template.evaluate()
      .setTitle('ユーザー登録 - FSL鹿児島県ICT支援スケジュールシステム')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }

  var existing = null;
  if (settings.targetMonth) {
    existing = getExistingCandidates_(email, settings.targetMonth);
  }

  var holidays = getHolidays_();
  var meetings = getMeetings_();

  // 担当支援員の休日のみフィルタリング（承認済のみ先生に表示）
  var allStaffOff = getStaffOff_().filter(function(s) { return s.status === '承認済'; });
  var schoolInfo = getSchoolByName_(userData.schoolName);
  var staffOff = allStaffOff;
  if (schoolInfo && schoolInfo.staffName) {
    staffOff = allStaffOff.filter(function(s) {
      return s.staffName === schoolInfo.staffName;
    });
  }

  var template = HtmlService.createTemplateFromFile('schedule');
  template.email = email;
  template.userData = JSON.stringify(userData);
  template.settings = JSON.stringify(settings);
  template.existing = JSON.stringify(existing);
  template.holidays = JSON.stringify(holidays);
  template.meetings = JSON.stringify(meetings);
  template.staffOff = JSON.stringify(staffOff);
  template.staffName = schoolInfo ? schoolInfo.staffName : '';
  template.supportCategory = schoolInfo ? schoolInfo.supportCategory : '通常';
  // 全確定スケジュール（月を絞らない）
  var allConfirmed = getSchedule_(null);
  var confirmedOnly = allConfirmed.filter(function(s) { return s.status === '確定'; });

  template.schoolSchedule = JSON.stringify(
    confirmedOnly.filter(function(s) { return s.schoolName === userData.schoolName; })
  );
  // 担当支援員の全確定スケジュール（学校間の交換検討用）
  var staffFullSchedule = [];
  if (schoolInfo && schoolInfo.staffName) {
    staffFullSchedule = confirmedOnly.filter(function(s) {
      return s.staffName === schoolInfo.staffName || s.origStaff === schoolInfo.staffName;
    });
  }
  template.staffFullSchedule = JSON.stringify(staffFullSchedule);
  template.baseUrl = baseUrl;
  return template.evaluate()
    .setTitle('候補日入力 - FSL鹿児島県ICT支援スケジュールシステム')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function serveSA_(email, settings, baseUrl) {
  var candidates = getAllCandidates_(settings.targetMonth);
  var users = getAllUsers_();
  var holidays = getHolidays_();
  var meetings = getMeetings_();
  var staffOff = getStaffOff_();
  var staffMembers = getStaffMembers_();
  var schools = getAllSchools_();

  var template = HtmlService.createTemplateFromFile('sa');
  template.email = email;
  template.settings = JSON.stringify(settings);
  template.candidates = JSON.stringify(candidates);
  template.users = JSON.stringify(users);
  template.holidays = JSON.stringify(holidays);
  template.meetings = JSON.stringify(meetings);
  template.staffOff = JSON.stringify(staffOff);
  template.staffMembers = JSON.stringify(staffMembers);
  template.schools = JSON.stringify(schools);
  template.scheduleData = JSON.stringify(getSchedule_(settings.targetMonth));
  template.priorityScores = JSON.stringify(getPriorityScores_());
  template.accountList = JSON.stringify(getAccountList_());
  template.baseUrl = baseUrl;
  return template.evaluate()
    .setTitle('SA管理画面 - FSL鹿児島県ICT支援スケジュールシステム')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function serveStaff_(email, settings, baseUrl) {
  var rawCandidates = getAllCandidates_(settings.targetMonth);
  // 支援員にはスケジュールコメント(comment)を共有しない
  var candidates = rawCandidates.map(function(c) {
    var copy = {};
    for (var k in c) copy[k] = c[k];
    copy.comment = '';
    return copy;
  });
  var staffScheduleInfo = getConfirmedScheduleForStaff(settings.targetMonth, email);
  var holidays = getHolidays_();
  var meetings = getMeetings_();
  var staffOff = getStaffOff_();

  var template = HtmlService.createTemplateFromFile('staff');
  template.email = email;
  template.settings = JSON.stringify(settings);
  template.candidates = JSON.stringify(candidates);
  template.mySchedule = JSON.stringify(staffScheduleInfo.schedule);
  template.myStaffName = staffScheduleInfo.staffName;
  template.holidays = JSON.stringify(holidays);
  template.meetings = JSON.stringify(meetings);
  template.staffOff = JSON.stringify(staffOff);
  template.baseUrl = baseUrl;
  return template.evaluate()
    .setTitle('支援員画面 - FSL鹿児島県ICT支援スケジュールシステム')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ===== ロール判定 =====

function detectRole_(email) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // SAマスタチェック
  var saSheet = ss.getSheetByName(SHEET_SA);
  if (saSheet) {
    var saData = saSheet.getDataRange().getValues();
    for (var i = 1; i < saData.length; i++) {
      if (String(saData[i][0]).trim() === email) return 'sa';
    }
  }

  // 支援員マスタチェック（個人メール）
  var staffSheet = ss.getSheetByName(SHEET_STAFF);
  if (staffSheet) {
    var staffData = staffSheet.getDataRange().getValues();
    for (var i = 1; i < staffData.length; i++) {
      if (String(staffData[i][0]).trim() === email) return 'staff';
    }
  }

  // 学校マスタの支援員メール列チェック
  var schoolSheet = ss.getSheetByName(SHEET_SCHOOLS);
  if (schoolSheet) {
    var schoolData = schoolSheet.getDataRange().getValues();
    for (var i = 1; i < schoolData.length; i++) {
      if (String(schoolData[i][3]).trim() === email) return 'staff';
    }
  }

  return 'teacher';
}

// ===== HTMLインクルード =====

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ===== ユーザー管理 =====

function getUserByEmail_(email) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_USERS);
  if (!sheet) return null;

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === email) {
      return {
        email: data[i][0],
        schoolName: data[i][1],
        name: data[i][2],
        role: data[i][3]
      };
    }
  }
  return null;
}

function getAllUsers_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_USERS);
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  var users = [];
  for (var i = 1; i < data.length; i++) {
    users.push({
      email: data[i][0],
      schoolName: data[i][1],
      name: data[i][2],
      role: data[i][3],
      registeredAt: data[i][4] instanceof Date
        ? Utilities.formatDate(data[i][4], 'Asia/Tokyo', 'yyyy/MM/dd')
        : ''
    });
  }
  return users;
}

function registerUser(formData) {
  var email = Session.getActiveUser().getEmail();

  if (getUserByEmail_(email)) {
    return { success: false, message: 'すでに登録済みです。' };
  }

  var sheet = getOrCreateSheet_(SHEET_USERS, ['メールアドレス', '学校名', '氏名', '担当', '登録日時']);
  sheet.appendRow([
    email,
    formData.schoolName.trim(),
    formData.name.trim(),
    formData.role.trim(),
    new Date()
  ]);

  return { success: true };
}

// ===== システム設定 =====

function getSystemSettings_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_SETTINGS);
  if (!sheet) {
    sheet = getOrCreateSheet_(SHEET_SETTINGS, ['設定名', '値']);
    sheet.appendRow(['対象年月', '']);
    sheet.appendRow(['締切日', '']);
    sheet.appendRow(['ステータス', '']);
    sheet.appendRow(['開発モード', 'ON']);
    return { targetMonth: '', deadline: '', status: '', devMode: 'ON' };
  }

  var data = sheet.getDataRange().getValues();
  var settings = { announcement: '' };
  var hasDevMode = false;
  var hasAnnouncement = false;
  for (var i = 1; i < data.length; i++) {
    var key = String(data[i][0]).trim();
    var val = data[i][1];
    if (key === '対象年月') {
      // Date/文字列いずれの場合も yyyy-MM 形式に統一（月のゼロ埋めも保証）
      settings.targetMonth = normalizeTargetMonth_(val);
    }
    if (key === '締切日') {
      if (val instanceof Date) {
        settings.deadline = Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM-dd');
      } else {
        settings.deadline = String(val).trim();
      }
    }
    if (key === 'ステータス') settings.status = String(val).trim();
    if (key === '開発モード') { settings.devMode = String(val).trim(); hasDevMode = true; }
    if (key === 'お知らせ') { settings.announcement = String(val == null ? '' : val); hasAnnouncement = true; }
  }

  // 開発モード行が未追加の場合、自動追加してONにする
  if (!hasDevMode) {
    sheet.appendRow(['開発モード', 'ON']);
    settings.devMode = 'ON';
  }
  // お知らせ行が未追加の場合、自動追加（空文字）
  if (!hasAnnouncement) {
    sheet.appendRow(['お知らせ', '']);
  }

  return settings;
}

function updateSystemSettings(newSettings) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_SETTINGS);
  if (!sheet) return { success: false, message: '設定シートが見つかりません。' };

  var data = sheet.getDataRange().getValues();
  var foundAnnouncement = false;
  for (var i = 1; i < data.length; i++) {
    var key = String(data[i][0]).trim();
    if (key === '対象年月' && newSettings.targetMonth !== undefined) {
      // 月をゼロ埋めしてから保存（"2026-6" → "2026-06"）
      sheet.getRange(i + 1, 2).setNumberFormat('@').setValue(normalizeTargetMonth_(newSettings.targetMonth));
    }
    if (key === '締切日' && newSettings.deadline !== undefined) {
      sheet.getRange(i + 1, 2).setValue(newSettings.deadline);
    }
    if (key === 'ステータス' && newSettings.status !== undefined) {
      sheet.getRange(i + 1, 2).setValue(newSettings.status);
    }
    if (key === 'お知らせ' && newSettings.announcement !== undefined) {
      sheet.getRange(i + 1, 2).setValue(newSettings.announcement);
      foundAnnouncement = true;
    }
  }
  if (newSettings.announcement !== undefined && !foundAnnouncement) {
    sheet.appendRow(['お知らせ', newSettings.announcement]);
  }

  return { success: true, message: '設定を更新しました。' };
}

// ===== 候補日管理 =====

function submitCandidates(formData) {
  var email = Session.getActiveUser().getEmail();
  var userData = getUserByEmail_(email);
  if (!userData) {
    return { success: false, message: 'ユーザー登録が必要です。' };
  }

  var settings = getSystemSettings_();
  if (settings.status !== '受付中') {
    return { success: false, message: '現在、候補日の受付は行っていません。' };
  }

  var headers = [
    'メールアドレス', '学校名', '氏名', '対象年月',
    '支援種別', '時間帯',
    '1回目_第1候補', '1回目_第2候補', '1回目_第3候補',
    '2回目希望', '2回目_支援種別', '2回目_時間帯',
    '2回目_第1候補', '2回目_第2候補', '2回目_第3候補',
    '備考', '送信日時', 'ICT支援要望'
  ];
  var sheet = getOrCreateSheet_(SHEET_CANDIDATES, headers);

  var data = sheet.getDataRange().getValues();
  var existingRow = -1;
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === email && normalizeTargetMonth_(data[i][3]) === settings.targetMonth) {
      existingRow = i + 1;
      break;
    }
  }

  var row = [
    email,
    userData.schoolName,
    userData.name,
    settings.targetMonth,
    formData.supportType || '',
    formData.timeSlot || '',
    formData.v1c1 || '',
    formData.v1c2 || '',
    formData.v1c3 || '',
    formData.wantSecond ? 'はい' : 'いいえ',
    formData.supportType2 || '',
    formData.timeSlot2 || '',
    formData.v2c1 || '',
    formData.v2c2 || '',
    formData.v2c3 || '',
    formData.comment || '',
    new Date(),
    formData.ictRequest || ''
  ];

  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }

  return { success: true, message: '候補日を送信しました。' };
}


function getExistingCandidates_(email, targetMonth) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_CANDIDATES);
  if (!sheet) return null;

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === email && normalizeTargetMonth_(data[i][3]) === targetMonth) {
      return {
        supportType: String(data[i][4]),
        timeSlot: String(data[i][5]),
        v1c1: normalizeCandidateDate_(data[i][6]),
        v1c2: normalizeCandidateDate_(data[i][7]),
        v1c3: normalizeCandidateDate_(data[i][8]),
        wantSecond: String(data[i][9]) === 'はい',
        supportType2: String(data[i][10]),
        timeSlot2: String(data[i][11]),
        v2c1: normalizeCandidateDate_(data[i][12]),
        v2c2: normalizeCandidateDate_(data[i][13]),
        v2c3: normalizeCandidateDate_(data[i][14]),
        comment: String(data[i][15]),
        ictRequest: String(data[i][17] == null ? '' : data[i][17]),
        submittedAt: data[i][16] instanceof Date
          ? Utilities.formatDate(data[i][16], 'Asia/Tokyo', 'yyyy/MM/dd HH:mm')
          : ''
      };
    }
  }
  return null;
}

// 対象年月の値をyyyy-MM文字列に正規化（Date型・文字列いずれにも対応、月のゼロ埋めも実施）
function normalizeTargetMonth_(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM');
  }
  var s = String(val == null ? '' : val).trim();
  var m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (m) {
    return m[1] + '-' + ('0' + m[2]).slice(-2);
  }
  return s;
}

// 候補日列の値をyyyy-MM-dd文字列に正規化
function normalizeCandidateDate_(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM-dd');
  }
  return String(val == null ? '' : val).trim();
}

function getAllCandidates_(targetMonth) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_CANDIDATES);
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  var results = [];
  for (var i = 1; i < data.length; i++) {
    var rowMonth = normalizeTargetMonth_(data[i][3]);
    if (targetMonth && rowMonth !== targetMonth) continue;
    results.push({
      email: String(data[i][0]),
      schoolName: String(data[i][1]),
      name: String(data[i][2]),
      targetMonth: rowMonth,
      supportType: String(data[i][4]),
      timeSlot: String(data[i][5]),
      v1c1: normalizeCandidateDate_(data[i][6]),
      v1c2: normalizeCandidateDate_(data[i][7]),
      v1c3: normalizeCandidateDate_(data[i][8]),
      wantSecond: String(data[i][9]) === 'はい',
      supportType2: String(data[i][10]),
      timeSlot2: String(data[i][11]),
      v2c1: normalizeCandidateDate_(data[i][12]),
      v2c2: normalizeCandidateDate_(data[i][13]),
      v2c3: normalizeCandidateDate_(data[i][14]),
      comment: String(data[i][15]),
      ictRequest: String(data[i][17] == null ? '' : data[i][17]),
      submittedAt: data[i][16] instanceof Date
        ? Utilities.formatDate(data[i][16], 'Asia/Tokyo', 'yyyy/MM/dd HH:mm')
        : ''
    });
  }
  return results;
}

// ===== WebアプリURL =====

function getWebAppUrl() {
  return ScriptApp.getService().getUrl();
}

// ===== 教育委員会向けトークン管理 =====

var BOARD_TOKEN_PROP = 'BOARD_TOKEN';

function generateBoardTokenString_() {
  var chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  var t = '';
  for (var i = 0; i < 40; i++) {
    t += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return t;
}

function getBoardToken_() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty(BOARD_TOKEN_PROP);
  if (!token) {
    token = generateBoardTokenString_();
    props.setProperty(BOARD_TOKEN_PROP, token);
  }
  return token;
}

// SA用：URL取得
function getBoardUrl() {
  var url = ScriptApp.getService().getUrl();
  var token = getBoardToken_();
  return { url: url + '?role=board&key=' + token, token: token };
}

// SA用：トークン再生成
function regenerateBoardToken() {
  var props = PropertiesService.getScriptProperties();
  var token = generateBoardTokenString_();
  props.setProperty(BOARD_TOKEN_PROP, token);
  var url = ScriptApp.getService().getUrl();
  return { success: true, url: url + '?role=board&key=' + token, token: token };
}

// 教育委員会画面のサーブ
function serveBoard_(params, baseUrl) {
  var providedKey = String((params && params.key) || '');
  var validKey = getBoardToken_();
  if (providedKey !== validKey) {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;padding:60px 20px;text-align:center;color:#202124;">' +
      '<h2 style="font-size:1.3rem; margin-bottom:12px;">アクセスできません</h2>' +
      '<p style="font-size:0.9rem; color:#5f6368;">このページは正しいリンクからアクセスしてください。</p>' +
      '</div>'
    ).setTitle('アクセスエラー');
  }

  // 確定済みスケジュール（ステータス=確定）のみ抽出
  var allSchedule = getSchedule_(null).filter(function(s) { return s.status === '確定'; });

  // 確定済みの月一覧（昇順）
  var monthSet = {};
  for (var i = 0; i < allSchedule.length; i++) {
    if (allSchedule[i].targetMonth) monthSet[allSchedule[i].targetMonth] = true;
  }
  var confirmedMonths = Object.keys(monthSet).sort();

  // 学校マスタから支援員→学校リストの対応を作る
  var schools = getAllSchools_();
  // 支援員一覧（学校マスタの担当支援員から重複なしで抽出。順序維持）
  var staffSet = {};
  var staffOrder = [];
  for (var j = 0; j < schools.length; j++) {
    var sn = schools[j].staffName;
    if (sn && !staffSet[sn]) {
      staffSet[sn] = true;
      staffOrder.push(sn);
    }
  }

  var holidays = getHolidays_();
  var meetings = getMeetings_();

  var template = HtmlService.createTemplateFromFile('board');
  template.baseUrl = baseUrl;
  template.schedule = JSON.stringify(allSchedule);
  template.confirmedMonths = JSON.stringify(confirmedMonths);
  template.staffMembers = JSON.stringify(staffOrder);
  template.holidays = JSON.stringify(holidays);
  template.meetings = JSON.stringify(meetings);
  return template.evaluate()
    .setTitle('スケジュール閲覧 - FSL鹿児島県ICT支援スケジュールシステム')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ===== ユーティリティ =====

function getOrCreateSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ===== 休日・定例会管理 =====

function getHolidays_() {
  return getDateList_(SHEET_HOLIDAYS, ['日付', '名称']);
}

function getMeetings_() {
  return getDateList_(SHEET_MEETINGS, ['日付', '名称']);
}

var STAFF_OFF_HEADERS = ['日付', '支援員名', '備考', 'ステータス', '却下理由', '申請者メール', '申請日時'];

function getStaffOff_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_STAFF_OFF);
  if (!sheet) {
    sheet = getOrCreateSheet_(SHEET_STAFF_OFF, STAFF_OFF_HEADERS);
    return [];
  }
  ensureStaffOffStatusColumns_(sheet);
  var data = sheet.getDataRange().getValues();
  var results = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    var d = data[i][0];
    var status = String(data[i][3] || '').trim();
    if (!status) status = '承認済'; // 旧データ・SA直接追加分は承認済扱い
    var reqAt = data[i][6];
    results.push({
      date: d instanceof Date ? Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd') : String(d).trim(),
      staffName: String(data[i][1] || '').trim(),
      note: String(data[i][2] || '').trim(),
      status: status,
      rejectReason: String(data[i][4] || '').trim(),
      requesterEmail: String(data[i][5] || '').trim(),
      requestedAt: reqAt instanceof Date
        ? Utilities.formatDate(reqAt, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm')
        : String(reqAt || '').trim()
    });
  }
  return results;
}

// 既存シートに新列が無い場合に補う
function ensureStaffOffStatusColumns_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol >= STAFF_OFF_HEADERS.length) return;
  for (var i = lastCol; i < STAFF_OFF_HEADERS.length; i++) {
    var col = i + 1;
    sheet.getRange(1, col).setValue(STAFF_OFF_HEADERS[i])
      .setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff');
  }
}

function getDateList_(sheetName, defaultHeaders) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = getOrCreateSheet_(sheetName, defaultHeaders);
    return [];
  }
  var data = sheet.getDataRange().getValues();
  var results = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    var d = data[i][0];
    results.push({
      date: d instanceof Date ? Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd') : String(d).trim(),
      name: String(data[i][1] || '').trim()
    });
  }
  return results;
}

function addHoliday(dateStr, name) {
  var sheet = getOrCreateSheet_(SHEET_HOLIDAYS, ['日付', '名称']);
  sheet.appendRow([dateStr, name]);
  return { success: true };
}

function removeHoliday(dateStr) {
  return removeDate_(SHEET_HOLIDAYS, dateStr);
}

function addMeeting(dateStr, name) {
  var sheet = getOrCreateSheet_(SHEET_MEETINGS, ['日付', '名称']);
  sheet.appendRow([dateStr, name]);
  return { success: true };
}

function removeMeeting(dateStr) {
  return removeDate_(SHEET_MEETINGS, dateStr);
}

function addStaffOff(dateStr, staffName, note) {
  var sheet = getOrCreateSheet_(SHEET_STAFF_OFF, STAFF_OFF_HEADERS);
  ensureStaffOffStatusColumns_(sheet);
  // 重複チェック（同支援員・同日は不可）
  var existing = getStaffOff_();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].date === dateStr && existing[i].staffName === staffName) {
      return { success: false, message: '既に登録されています（' + existing[i].status + '）' };
    }
  }
  sheet.appendRow([dateStr, staffName, note || '', '承認済', '', '', new Date()]);
  return { success: true };
}

// ===== 支援員休み申請ワークフロー =====

function getStaffNameByEmail_(email) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var staffSheet = ss.getSheetByName(SHEET_STAFF);
  if (staffSheet) {
    var data = staffSheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]).trim() === email) return String(data[i][1]).trim();
    }
  }
  var schoolSheet = ss.getSheetByName(SHEET_SCHOOLS);
  if (schoolSheet) {
    var data = schoolSheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][3]).trim() === email) return String(data[i][2]).trim();
    }
  }
  return '';
}

// 支援員：休み申請（申請中で挿入）
function requestStaffOff(formData) {
  var realEmail = Session.getActiveUser().getEmail();
  var settings = getSystemSettings_();
  var devMode = settings.devMode === 'ON';
  // なりすまし（DEV）対応
  var email = (devMode && formData && formData.impersonate) ? formData.impersonate : realEmail;

  var staffName = getStaffNameByEmail_(email);
  if (!staffName) {
    return { success: false, message: '支援員として認識できませんでした。' };
  }
  var dateStr = formData && formData.date ? String(formData.date).trim() : '';
  var note = formData && formData.note ? String(formData.note).trim() : '';
  if (!dateStr) {
    return { success: false, message: '日付を入力してください。' };
  }

  // 重複チェック
  var existing = getStaffOff_();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].date === dateStr && existing[i].staffName === staffName) {
      return { success: false, message: '同じ日に既に申請があります（ステータス: ' + existing[i].status + '）' };
    }
  }

  var sheet = getOrCreateSheet_(SHEET_STAFF_OFF, STAFF_OFF_HEADERS);
  ensureStaffOffStatusColumns_(sheet);
  sheet.appendRow([dateStr, staffName, note, '申請中', '', email, new Date()]);
  return { success: true, message: '休み申請を送信しました。SAの承認をお待ちください。' };
}

// 支援員：申請中の取り下げ（自身の申請のみ・申請中のみ）
function withdrawStaffOff(formData) {
  var realEmail = Session.getActiveUser().getEmail();
  var settings = getSystemSettings_();
  var devMode = settings.devMode === 'ON';
  var email = (devMode && formData && formData.impersonate) ? formData.impersonate : realEmail;

  var staffName = getStaffNameByEmail_(email);
  if (!staffName) {
    return { success: false, message: '支援員として認識できませんでした。' };
  }
  var dateStr = formData && formData.date ? String(formData.date).trim() : '';
  if (!dateStr) return { success: false, message: '日付が指定されていません。' };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_STAFF_OFF);
  if (!sheet) return { success: false, message: '休日シートが見つかりません。' };
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    var d = data[i][0];
    var dStr = d instanceof Date ? Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd') : String(d).trim();
    if (dStr !== dateStr) continue;
    if (String(data[i][1]).trim() !== staffName) continue;
    var status = String(data[i][3] || '').trim() || '承認済';
    if (status !== '申請中') {
      return { success: false, message: '申請中以外は取り下げできません（現在: ' + status + '）。SAにご相談ください。' };
    }
    sheet.deleteRow(i + 1);
    return { success: true, message: '申請を取り下げました。' };
  }
  return { success: false, message: '該当する申請が見つかりません。' };
}

// SA：申請を承認
function approveStaffOff(dateStr, staffName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_STAFF_OFF);
  if (!sheet) return { success: false, message: 'シートが見つかりません。' };
  ensureStaffOffStatusColumns_(sheet);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var d = data[i][0];
    var dStr = d instanceof Date ? Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd') : String(d).trim();
    if (dStr === dateStr && String(data[i][1]).trim() === staffName) {
      sheet.getRange(i + 1, 4).setValue('承認済');
      sheet.getRange(i + 1, 5).setValue('');
      return { success: true, message: '承認しました。' };
    }
  }
  return { success: false, message: '該当の申請が見つかりません。' };
}

// SA：申請を却下（理由付き）
function rejectStaffOff(dateStr, staffName, reason) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_STAFF_OFF);
  if (!sheet) return { success: false, message: 'シートが見つかりません。' };
  ensureStaffOffStatusColumns_(sheet);
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var d = data[i][0];
    var dStr = d instanceof Date ? Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd') : String(d).trim();
    if (dStr === dateStr && String(data[i][1]).trim() === staffName) {
      sheet.getRange(i + 1, 4).setValue('却下');
      sheet.getRange(i + 1, 5).setValue(reason || '');
      return { success: true, message: '却下しました。' };
    }
  }
  return { success: false, message: '該当の申請が見つかりません。' };
}

function removeStaffOff(dateStr, staffName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_STAFF_OFF);
  if (!sheet) return { success: false };
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    var d = data[i][0];
    var dStr = d instanceof Date ? Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd') : String(d).trim();
    if (dStr === dateStr && String(data[i][1]).trim() === staffName) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false };
}

function removeDate_(sheetName, dateStr) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { success: false };
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    var d = data[i][0];
    var dStr = d instanceof Date ? Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd') : String(d).trim();
    if (dStr === dateStr) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false };
}

// ===== 支援員一覧 =====

function getAccountList_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var accounts = { sa: [], staff: [], teacher: [] };

  // SA
  var saSheet = ss.getSheetByName(SHEET_SA);
  if (saSheet) {
    var saData = saSheet.getDataRange().getValues();
    for (var i = 1; i < saData.length; i++) {
      var email = String(saData[i][0] || '').trim();
      var name = String(saData[i][1] || '').trim();
      if (email) accounts.sa.push({ email: email, name: name || email });
    }
  }

  // 支援員（学校マスタの支援員メールから取得、支援員名でグループ化）
  var schoolSheet = ss.getSheetByName(SHEET_SCHOOLS);
  if (schoolSheet) {
    var schoolData = schoolSheet.getDataRange().getValues();
    var staffSeen = {};
    for (var i = 1; i < schoolData.length; i++) {
      var staffName = String(schoolData[i][2] || '').trim();
      var staffEmail = String(schoolData[i][3] || '').trim();
      var schoolName = String(schoolData[i][1] || '').trim();
      if (staffEmail && !staffSeen[staffEmail]) {
        staffSeen[staffEmail] = true;
        accounts.staff.push({ email: staffEmail, name: staffName + '（' + schoolName + '）' });
      }
    }
  }

  // 先生（ユーザーシートから）
  var userSheet = ss.getSheetByName(SHEET_USERS);
  if (userSheet) {
    var userData = userSheet.getDataRange().getValues();
    for (var i = 1; i < userData.length; i++) {
      var email = String(userData[i][0] || '').trim();
      var schoolName = String(userData[i][1] || '').trim();
      var name = String(userData[i][2] || '').trim();
      if (email) accounts.teacher.push({ email: email, name: name + '（' + schoolName + '）' });
    }
  }

  return accounts;
}

function getStaffMembers_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_STAFF);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  var results = [];
  for (var i = 1; i < data.length; i++) {
    var name = String(data[i][1] || '').trim();
    if (name) results.push(name);
  }
  return results;
}

// ===== 学校マスタ =====

function getSchoolByEmail_(email) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_SCHOOLS);
  if (!sheet) return null;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][3]).trim() === email) {
      return {
        schoolCode: String(data[i][0]).trim(),
        schoolName: String(data[i][1]).trim(),
        staffName: String(data[i][2]).trim(),
        staffEmail: String(data[i][3]).trim()
      };
    }
  }
  return null;
}

function getSchoolByName_(schoolName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_SCHOOLS);
  if (!sheet) return null;
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim() === schoolName) {
      return {
        schoolCode: String(data[i][0]).trim(),
        schoolName: String(data[i][1]).trim(),
        staffName: String(data[i][2]).trim(),
        staffEmail: String(data[i][3]).trim(),
        supportCategory: String(data[i][4] || '通常').trim()
      };
    }
  }
  return null;
}

function getSchoolsByStaffName_(staffName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_SCHOOLS);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  var results = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][2]).trim() === staffName) {
      results.push({
        schoolCode: String(data[i][0]).trim(),
        schoolName: String(data[i][1]).trim(),
        staffName: String(data[i][2]).trim(),
        staffEmail: String(data[i][3]).trim()
      });
    }
  }
  return results;
}

function getAllSchools_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_SCHOOLS);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  var results = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0] && !data[i][1]) continue;
    results.push({
      schoolCode: String(data[i][0]).trim(),
      schoolName: String(data[i][1]).trim(),
      staffName: String(data[i][2]).trim(),
      staffEmail: String(data[i][3]).trim()
    });
  }
  return results;
}

// ===== 初期セットアップ =====

function setupMasterSheets() {
  getOrCreateSheet_(SHEET_SA, ['メールアドレス', '氏名']);
  getOrCreateSheet_(SHEET_STAFF, ['メールアドレス', '氏名', '担当エリア']);
  getOrCreateSheet_(SHEET_SCHOOLS, ['学校番号', '学校名', '担当支援員', '支援員メール', '支援区分']);
}

function setupSchoolMaster() {
  var schools = [
    // 三池 博孝（アイタイムズ）― 奄美エリア（離島）
    [1001, '大島高校', '三池 博孝', 'ict0013@kago.ed.jp', '離島'],
    [1002, '奄美高校', '三池 博孝', 'ict0013@kago.ed.jp', '離島'],
    [1003, '大島北高校', '三池 博孝', 'ict0013@kago.ed.jp', '離島'],
    [1004, '古仁屋高校', '三池 博孝', 'ict0013@kago.ed.jp', '離島'],
    [1005, '喜界高校', '三池 博孝', 'ict0013@kago.ed.jp', '離島'],
    [1006, '大島特別支援', '三池 博孝', 'ict0013@kago.ed.jp', '離島'],
    // 鈴木 亮 ― 北薩・種子島エリア
    [1007, '川内高校', '鈴木 亮', 'ict0004@kago.ed.jp', '通常'],
    [1008, '出水特別支援', '鈴木 亮', 'ict0004@kago.ed.jp', '通常'],
    [1009, '中種子特別支援', '鈴木 亮', 'ict0004@kago.ed.jp', '離島'],
    [1010, '薩摩中央高校', '鈴木 亮', 'ict0004@kago.ed.jp', '通常'],
    [1011, '鶴翔高校', '鈴木 亮', 'ict0004@kago.ed.jp', '通常'],
    [1012, '野田女子高校', '鈴木 亮', 'ict0004@kago.ed.jp', '通常'],
    [1013, '出水高校', '鈴木 亮', 'ict0004@kago.ed.jp', '通常'],
    [1014, '出水工業高校', '鈴木 亮', 'ict0004@kago.ed.jp', '通常'],
    [1015, '種子島高校', '鈴木 亮', 'ict0004@kago.ed.jp', '離島'],
    [1016, '種子島中央高校', '鈴木 亮', 'ict0004@kago.ed.jp', '離島'],
    // 谷口 涼子 ― 伊佐エリア
    [1017, '大口高校', '谷口 涼子', 'ict0005@kago.ed.jp', '通常'],
    [1018, '伊佐農林高校', '谷口 涼子', 'ict0005@kago.ed.jp', '通常'],
    // 橋口 大地 ― 姶良エリア
    [1019, '明桜館高校', '橋口 大地', 'ict0006@kago.ed.jp', '通常'],
    [1020, '蒲生高校', '橋口 大地', 'ict0006@kago.ed.jp', '通常'],
    // 水元 理恵子 ― 大隅・霧島エリア
    [1021, '鶴丸高校', '水元 理恵子', 'ict0001@kago.ed.jp', '通常'],
    [1022, '鹿児島東高校', '水元 理恵子', 'ict0001@kago.ed.jp', '通常'],
    [1023, '川内商工高校', '水元 理恵子', 'ict0001@kago.ed.jp', '通常'],
    [1024, '川薩清修館高校', '水元 理恵子', 'ict0001@kago.ed.jp', '通常'],
    [1025, '霧島高校', '水元 理恵子', 'ict0001@kago.ed.jp', '通常'],
    [1026, '隼人工業高校', '水元 理恵子', 'ict0001@kago.ed.jp', '通常'],
    [1027, '国分高校', '水元 理恵子', 'ict0001@kago.ed.jp', '通常'],
    [1028, '福山高校', '水元 理恵子', 'ict0001@kago.ed.jp', '通常'],
    [1029, '曽於高校', '水元 理恵子', 'ict0001@kago.ed.jp', '通常'],
    [1030, '志布志高校', '水元 理恵子', 'ict0001@kago.ed.jp', '通常'],
    [1031, '串良商業高校', '水元 理恵子', 'ict0001@kago.ed.jp', '通常'],
    [1032, '楠隼高校', '水元 理恵子', 'ict0001@kago.ed.jp', '通常'],
    [1033, '楠隼中学校', '水元 理恵子', 'ict0001@kago.ed.jp', '通常'],
    [1034, '鹿屋高校', '水元 理恵子', 'ict0001@kago.ed.jp', '通常'],
    [1035, '鹿屋農業高校', '水元 理恵子', 'ict0001@kago.ed.jp', '通常'],
    [1036, '鹿屋工業高校', '水元 理恵子', 'ict0001@kago.ed.jp', '通常'],
    [1037, '垂水高校', '水元 理恵子', 'ict0001@kago.ed.jp', '通常'],
    [1038, '牧之原特別支援', '水元 理恵子', 'ict0001@kago.ed.jp', '通常'],
    [1039, '鹿屋特別支援', '水元 理恵子', 'ict0001@kago.ed.jp', '通常'],
    // 村永 浩 ― 南薩・日置エリア
    [1040, '錦江湾高校', '村永 浩', 'ict0003@kago.ed.jp', '通常'],
    [1041, '開陽高校', '村永 浩', 'ict0003@kago.ed.jp', '通常'],
    [1042, '鹿児島工業高校', '村永 浩', 'ict0003@kago.ed.jp', '通常'],
    [1043, '指宿高校', '村永 浩', 'ict0003@kago.ed.jp', '通常'],
    [1044, '山川高校', '村永 浩', 'ict0003@kago.ed.jp', '通常'],
    [1045, '頴娃高校', '村永 浩', 'ict0003@kago.ed.jp', '通常'],
    [1046, '枕崎高校', '村永 浩', 'ict0003@kago.ed.jp', '通常'],
    [1047, '鹿児島水産高校', '村永 浩', 'ict0003@kago.ed.jp', '通常'],
    [1048, '加世田高校', '村永 浩', 'ict0003@kago.ed.jp', '通常'],
    [1049, '加世田常潤高校', '村永 浩', 'ict0003@kago.ed.jp', '通常'],
    [1050, '川辺高校', '村永 浩', 'ict0003@kago.ed.jp', '通常'],
    [1051, '薩南工業高校', '村永 浩', 'ict0003@kago.ed.jp', '通常'],
    [1052, '吹上高校', '村永 浩', 'ict0003@kago.ed.jp', '通常'],
    [1053, '串木野高校', '村永 浩', 'ict0003@kago.ed.jp', '通常'],
    [1054, '加治木高校', '村永 浩', 'ict0003@kago.ed.jp', '通常'],
    [1055, '加治木工業高校', '村永 浩', 'ict0003@kago.ed.jp', '通常'],
    [1056, '盲学校', '村永 浩', 'ict0003@kago.ed.jp', '通常'],
    [1057, '聾学校', '村永 浩', 'ict0003@kago.ed.jp', '通常'],
    [1058, '鹿児島南特別支援', '村永 浩', 'ict0003@kago.ed.jp', '通常'],
    [1059, '指宿特別支援', '村永 浩', 'ict0003@kago.ed.jp', '通常'],
    [1060, '南薩特別支援', '村永 浩', 'ict0003@kago.ed.jp', '通常'],
    [1061, '串木野特別支援', '村永 浩', 'ict0003@kago.ed.jp', '通常'],
    [1062, '加治木特別支援', '村永 浩', 'ict0003@kago.ed.jp', '通常'],
    // 谷川 麗華 ― 鹿児島市エリア
    [1063, '甲南高校', '谷川 麗華', 'ict0007@kago.ed.jp', '通常'],
    [1064, '鹿児島中央高校', '谷川 麗華', 'ict0007@kago.ed.jp', '通常'],
    [1065, '武岡台高校', '谷川 麗華', 'ict0007@kago.ed.jp', '通常'],
    [1066, '松陽高校', '谷川 麗華', 'ict0007@kago.ed.jp', '通常'],
    [1067, '鹿児島南高校', '谷川 麗華', 'ict0007@kago.ed.jp', '通常'],
    [1068, '南大隅高校', '谷川 麗華', 'ict0007@kago.ed.jp', '通常'],
    [1069, '屋久島高校', '谷川 麗華', 'ict0007@kago.ed.jp', '離島'],
    [1070, 'いろは中学校', '谷川 麗華', 'ict0007@kago.ed.jp', '通常'],
    [1071, '武岡台特別支援', '谷川 麗華', 'ict0007@kago.ed.jp', '通常'],
    [1072, '鹿児島特別支援', '谷川 麗華', 'ict0007@kago.ed.jp', '通常'],
    [1073, '鹿児島高等特別支援', '谷川 麗華', 'ict0007@kago.ed.jp', '通常'],
    // 中根 秀幸 ― 与論エリア（離島）
    [1074, '与論高校', '中根 秀幸', 'ict0009@kago.ed.jp', '離島'],
    // 抜迫 大地 ― 日置・離島エリア
    [1075, '伊集院高校', '抜迫 大地', 'ict0008@kago.ed.jp', '通常'],
    [1076, '市来農芸高校', '抜迫 大地', 'ict0008@kago.ed.jp', '通常'],
    [1077, '徳之島高校', '抜迫 大地', 'ict0008@kago.ed.jp', '離島'],
    [1078, '沖永良部高校', '抜迫 大地', 'ict0008@kago.ed.jp', '離島'],
    // 村永 浩 ― 枕崎市（市町村案件）
    [1079, '枕崎小学校', '村永 浩', 'ict0003@kago.ed.jp', '市町村'],
    [1080, '桜山小学校', '村永 浩', 'ict0003@kago.ed.jp', '市町村'],
    [1081, '別府小学校', '村永 浩', 'ict0003@kago.ed.jp', '市町村'],
    [1082, '立神小学校', '村永 浩', 'ict0003@kago.ed.jp', '市町村'],
    [1083, '枕崎中学校', '村永 浩', 'ict0003@kago.ed.jp', '市町村'],
    [1084, '桜山中学校', '村永 浩', 'ict0003@kago.ed.jp', '市町村'],
    [1085, '別府中学校', '村永 浩', 'ict0003@kago.ed.jp', '市町村'],
    [1086, '立神中学校', '村永 浩', 'ict0003@kago.ed.jp', '市町村']
  ];

  var sheet = getOrCreateSheet_(SHEET_SCHOOLS, ['学校番号', '学校名', '担当支援員', '支援員メール', '支援区分']);

  // 既存データがあればクリア（ヘッダー行は残す）
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).clearContent();
  }

  // データ投入
  if (schools.length > 0) {
    sheet.getRange(2, 1, schools.length, 5).setValues(schools);
  }

  // 支援員マスタも投入
  var staffMembers = [
    ['ict0001@kago.ed.jp', '水元 理恵子', '大隅・霧島エリア'],
    ['ict0002@kago.ed.jp', '山崎 混平', 'SA'],
    ['ict0003@kago.ed.jp', '村永 浩', '南薩・日置エリア'],
    ['ict0004@kago.ed.jp', '鈴木 亮', '北薩・種子島エリア'],
    ['ict0005@kago.ed.jp', '谷口 涼子', '伊佐エリア'],
    ['ict0006@kago.ed.jp', '橋口 大地', '姶良エリア'],
    ['ict0007@kago.ed.jp', '谷川 麗華', '鹿児島市エリア'],
    ['ict0008@kago.ed.jp', '抜迫 大地', '日置・離島エリア'],
    ['ict0009@kago.ed.jp', '中根 秀幸', '与論エリア'],
    ['ict0013@kago.ed.jp', '三池 博孝', '奄美エリア']
  ];
  var staffSheet = getOrCreateSheet_(SHEET_STAFF, ['メールアドレス', '氏名', '担当エリア']);
  if (staffSheet.getLastRow() > 1) {
    staffSheet.getRange(2, 1, staffSheet.getLastRow() - 1, 3).clearContent();
  }
  staffSheet.getRange(2, 1, staffMembers.length, 3).setValues(staffMembers);

  // SAマスタにも登録（専任SA + 支援員兼任SA）
  var saSheet = getOrCreateSheet_(SHEET_SA, ['メールアドレス', '氏名']);
  if (saSheet.getLastRow() > 1) {
    saSheet.getRange(2, 1, saSheet.getLastRow() - 1, 2).clearContent();
  }
  var saList = [
    ['ict0010@kago.ed.jp', '濵﨑 生'],
    ['ict0002@kago.ed.jp', '山崎 混平'],
    // 支援員兼任SA（メイン役割は支援員、ログイン時はSA優先）
    ['ict0006@kago.ed.jp', '橋口 大地'],
    ['ict0007@kago.ed.jp', '谷川 麗華'],
    ['ict0008@kago.ed.jp', '抜迫 大地'],
    ['ict0009@kago.ed.jp', '中根 秀幸']
  ];
  saSheet.getRange(2, 1, saList.length, 2).setValues(saList);

  return { success: true, message: '学校マスタ ' + schools.length + '校、支援員マスタ ' + staffMembers.length + '名、SAマスタ ' + saList.length + '名を登録しました。' };
}

// 支援員兼任SA 4名の追加（既存SAマスタを保持したまま追記）
function addDualRoleSAs() {
  var sheet = getOrCreateSheet_(SHEET_SA, ['メールアドレス', '氏名']);
  var data = sheet.getDataRange().getValues();
  var existingEmails = {};
  for (var i = 1; i < data.length; i++) {
    var em = String(data[i][0] || '').trim();
    if (em) existingEmails[em] = true;
  }

  var dualRoleSAs = [
    ['ict0006@kago.ed.jp', '橋口 大地'],
    ['ict0007@kago.ed.jp', '谷川 麗華'],
    ['ict0008@kago.ed.jp', '抜迫 大地'],
    ['ict0009@kago.ed.jp', '中根 秀幸']
  ];

  var toInsert = [];
  var skipped = [];
  for (var i = 0; i < dualRoleSAs.length; i++) {
    var row = dualRoleSAs[i];
    if (existingEmails[row[0]]) {
      skipped.push(row[1]);
    } else {
      toInsert.push(row);
    }
  }

  if (toInsert.length > 0) {
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, toInsert.length, 2).setValues(toInsert);
  }

  var msg = toInsert.length + '名をSAマスタに追加しました。';
  if (skipped.length > 0) msg += '（既存のためスキップ: ' + skipped.join('、') + '）';
  return { success: true, message: msg };
}

// 枕崎市8校の追加（既存マスタを保持したまま追記）
function addMakurazakiSchools() {
  var sheet = getOrCreateSheet_(SHEET_SCHOOLS, ['学校番号', '学校名', '担当支援員', '支援員メール', '支援区分']);
  var data = sheet.getDataRange().getValues();

  var existingNames = {};
  var existingCodes = {};
  for (var i = 1; i < data.length; i++) {
    var code = String(data[i][0] || '').trim();
    var name = String(data[i][1] || '').trim();
    if (code) existingCodes[code] = true;
    if (name) existingNames[name] = true;
  }

  var newSchools = [
    [1079, '枕崎小学校', '村永 浩', 'ict0003@kago.ed.jp', '市町村'],
    [1080, '桜山小学校', '村永 浩', 'ict0003@kago.ed.jp', '市町村'],
    [1081, '別府小学校', '村永 浩', 'ict0003@kago.ed.jp', '市町村'],
    [1082, '立神小学校', '村永 浩', 'ict0003@kago.ed.jp', '市町村'],
    [1083, '枕崎中学校', '村永 浩', 'ict0003@kago.ed.jp', '市町村'],
    [1084, '桜山中学校', '村永 浩', 'ict0003@kago.ed.jp', '市町村'],
    [1085, '別府中学校', '村永 浩', 'ict0003@kago.ed.jp', '市町村'],
    [1086, '立神中学校', '村永 浩', 'ict0003@kago.ed.jp', '市町村']
  ];

  var toInsert = [];
  var skipped = [];
  for (var i = 0; i < newSchools.length; i++) {
    var row = newSchools[i];
    var code = String(row[0]);
    var name = String(row[1]);
    if (existingCodes[code] || existingNames[name]) {
      skipped.push(name);
    } else {
      toInsert.push(row);
    }
  }

  if (toInsert.length > 0) {
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, toInsert.length, 5).setValues(toInsert);
  }

  var msg = toInsert.length + '校を追加しました。';
  if (skipped.length > 0) msg += '（既存のためスキップ: ' + skipped.join('、') + '）';
  return { success: true, message: msg };
}

// ===== 6月・7月サンプルデータ生成 =====

// メイン関数: 6月+7月のサンプルデータをまとめて投入（既存5月データは保持、追記モード）
function setupSampleDataJunJul2026() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. 学校マスタを読み込み
  var schoolSheet = ss.getSheetByName(SHEET_SCHOOLS);
  if (!schoolSheet) return { success: false, message: '学校マスタが見つかりません' };
  var schoolData = schoolSheet.getDataRange().getValues();
  var allSchools = [];
  for (var i = 1; i < schoolData.length; i++) {
    if (!schoolData[i][0] || !schoolData[i][1]) continue;
    var category = String(schoolData[i][4] || '通常').trim();
    allSchools.push({
      code: String(schoolData[i][0]).trim(),
      name: String(schoolData[i][1]).trim(),
      category: category,
      isIsland: category === '離島',
      isMakurazaki: category === '市町村'
    });
  }

  // 2. サンプル教員氏名（romaji付き）
  var TEACHER_NAMES = [
    { sn: '田中', fn: '太郎',     rsn: 'tanaka' },
    { sn: '佐藤', fn: '花子',     rsn: 'sato' },
    { sn: '鈴木', fn: '一郎',     rsn: 'suzuki' },
    { sn: '高橋', fn: '美咲',     rsn: 'takahashi' },
    { sn: '渡辺', fn: '健太',     rsn: 'watanabe' },
    { sn: '伊藤', fn: '裕子',     rsn: 'ito' },
    { sn: '山本', fn: '大輔',     rsn: 'yamamoto' },
    { sn: '中村', fn: 'あゆみ',   rsn: 'nakamura' },
    { sn: '小林', fn: '翔',       rsn: 'kobayashi' },
    { sn: '加藤', fn: '真由美',   rsn: 'kato' },
    { sn: '吉田', fn: '拓也',     rsn: 'yoshida' },
    { sn: '山田', fn: '恵子',     rsn: 'yamada' },
    { sn: '松本', fn: '直樹',     rsn: 'matsumoto' },
    { sn: '井上', fn: '智子',     rsn: 'inoue' },
    { sn: '木村', fn: '雄一',     rsn: 'kimura' },
    { sn: '林',   fn: '由美',     rsn: 'hayashi' },
    { sn: '斎藤', fn: '誠',       rsn: 'saito' },
    { sn: '清水', fn: '京子',     rsn: 'shimizu' },
    { sn: '山口', fn: '正',       rsn: 'yamaguchi' },
    { sn: '森',   fn: '節子',     rsn: 'mori' }
  ];
  var ROLES = ['教頭', 'ICT担当', '情報教育担当', '研究主任'];

  // 3. 教員アカウント生成（既存と重複しないものだけ追加）
  var userSheet = getOrCreateSheet_(SHEET_USERS, ['メールアドレス', '学校名', '氏名', '担当', '登録日時']);
  var existingEmails = {};
  if (userSheet.getLastRow() > 1) {
    var ed = userSheet.getRange(2, 1, userSheet.getLastRow() - 1, 5).getValues();
    for (var i = 0; i < ed.length; i++) {
      var em = String(ed[i][0]).trim();
      if (em) existingEmails[em] = true;
    }
  }

  var newUsers = [];
  for (var i = 0; i < allSchools.length; i++) {
    var school = allSchools[i];
    var nameInfo = TEACHER_NAMES[i % TEACHER_NAMES.length];
    var email;
    if (school.isMakurazaki) {
      // 市町村: t + 学校番号 + 苗字頭文字 (例: t1079t@kago.ed.jp)
      email = 't' + school.code + nameInfo.rsn.charAt(0) + '@kago.ed.jp';
    } else {
      // 県立高校: s-苗字 + 学校番号 (例: s-tanaka1001@kago.ed.jp)
      email = 's-' + nameInfo.rsn + school.code + '@kago.ed.jp';
    }
    school.teacherEmail = email;
    school.teacherName = nameInfo.sn + ' ' + nameInfo.fn;
    school.teacherRole = ROLES[i % ROLES.length];

    if (!existingEmails[email]) {
      var regDate = new Date(2026, 4, 10 + (i % 15)); // 5月10〜24日に登録
      newUsers.push([email, school.name, school.teacherName, school.teacherRole, regDate]);
    }
  }
  if (newUsers.length > 0) {
    userSheet.getRange(userSheet.getLastRow() + 1, 1, newUsers.length, 5).setValues(newUsers);
  }

  // 4. 候補日生成（6月+7月）
  var candHeaders = [
    'メールアドレス', '学校名', '氏名', '対象年月',
    '支援種別', '時間帯',
    '1回目_第1候補', '1回目_第2候補', '1回目_第3候補',
    '2回目希望', '2回目_支援種別', '2回目_時間帯',
    '2回目_第1候補', '2回目_第2候補', '2回目_第3候補',
    '備考', '送信日時', 'ICT支援要望'
  ];
  var candSheet = getOrCreateSheet_(SHEET_CANDIDATES, candHeaders);

  var weekdaysJun = getWeekdaysInMonth_(2026, 6);
  var weekdaysJul = getWeekdaysInMonth_(2026, 7);

  var allRows = [];
  for (var i = 0; i < allSchools.length; i++) {
    var school = allSchools[i];
    var rand = seededRand_(parseInt(school.code) * 31 + 17);

    var junePlan, julyPlan;
    if (school.isMakurazaki) {
      // 枕崎: 6月・7月どちらも訪問1回必須
      junePlan = { v: 1, o: 0 };
      julyPlan = { v: 1, o: 0 };
    } else {
      // 県立高校: 2か月合計の訪問・オンライン回数を抽選し、月ごとに分配
      var totalV = pickWeighted_([
        { v: 0, w: 25 }, { v: 1, w: 55 }, { v: 2, w: 18 }, { v: 3, w: 2 }
      ], rand());
      var totalO = pickWeighted_([
        { v: 0, w: 60 }, { v: 1, w: 30 }, { v: 2, w: 10 }
      ], rand());
      junePlan = { v: 0, o: 0 };
      julyPlan = { v: 0, o: 0 };
      for (var k = 0; k < totalV; k++) {
        if (rand() < 0.5) junePlan.v++; else julyPlan.v++;
      }
      for (var k = 0; k < totalO; k++) {
        if (rand() < 0.5) junePlan.o++; else julyPlan.o++;
      }
    }

    var juneRow = buildCandidateRow_(school, '2026-06', junePlan, weekdaysJun, rand, i);
    if (juneRow) allRows.push(juneRow);
    var julyRow = buildCandidateRow_(school, '2026-07', julyPlan, weekdaysJul, rand, i + 100);
    if (julyRow) allRows.push(julyRow);
  }

  if (allRows.length > 0) {
    var startRow = candSheet.getLastRow() + 1;
    // 先に範囲を確保し、対象年月・候補日列を文字列フォーマットに固定
    var fullRange = candSheet.getRange(startRow, 1, allRows.length, candHeaders.length);
    fullRange.setNumberFormat('@');  // 全列を一旦文字列扱いに
    SpreadsheetApp.flush();
    fullRange.setValues(allRows);
    // 送信日時（17列目）だけは日付フォーマットに戻す
    candSheet.getRange(startRow, 17, allRows.length, 1).setNumberFormat('yyyy/mm/dd hh:mm');
  }

  // 集計
  var juneCount = 0, julyCount = 0;
  for (var i = 0; i < allRows.length; i++) {
    if (allRows[i][3] === '2026-06') juneCount++;
    else if (allRows[i][3] === '2026-07') julyCount++;
  }

  return {
    success: true,
    message: 'サンプルデータ生成完了: 教員追加 ' + newUsers.length + '名、候補日 6月 ' + juneCount + '件 / 7月 ' + julyCount + '件'
  };
}

// 1校1月分の候補日レコードを構築
function buildCandidateRow_(school, targetMonth, plan, weekdays, rand, submitIdx) {
  if (plan.v + plan.o === 0) return null;

  var supportType = '', timeSlot = '', v1c1 = '', v1c2 = '', v1c3 = '';
  var wantSecond = false, supportType2 = '', timeSlot2 = '';
  var v2c1 = '', v2c2 = '', v2c3 = '';
  var comment = '';

  // 1回目: 訪問優先
  if (plan.v >= 1) {
    supportType = '訪問';
    timeSlot = school.isIsland ? '09:00-16:00' : (rand() < 0.5 ? '09:00-12:00' : '13:30-16:30');
  } else {
    supportType = 'オンライン';
    timeSlot = pickOnlineTime_(rand);
  }
  var p1 = pick3Dates_(weekdays, rand);
  v1c1 = p1[0] || '特に指定しない';
  v1c2 = p1[1] || '特に指定しない';
  v1c3 = p1[2] || '特に指定しない';

  // 2回目
  var vRem = plan.v - (supportType === '訪問' ? 1 : 0);
  var oRem = plan.o - (supportType === 'オンライン' ? 1 : 0);

  if (vRem >= 1) {
    wantSecond = true;
    supportType2 = '訪問';
    timeSlot2 = school.isIsland ? '09:00-16:00' : (rand() < 0.5 ? '09:00-12:00' : '13:30-16:30');
    var p2 = pick3Dates_(weekdays, rand);
    v2c1 = p2[0] || '特に指定しない';
    v2c2 = p2[1] || '特に指定しない';
    v2c3 = p2[2] || '特に指定しない';
    vRem--;
  } else if (oRem >= 1) {
    wantSecond = true;
    supportType2 = 'オンライン';
    timeSlot2 = pickOnlineTime_(rand);
    var p2 = pick3Dates_(weekdays, rand);
    v2c1 = p2[0] || '特に指定しない';
    v2c2 = p2[1] || '特に指定しない';
    v2c3 = p2[2] || '特に指定しない';
    oRem--;
  }

  // 余り（同月内で2枠を超える要望）はコメントへ
  if (vRem > 0 || oRem > 0) {
    var parts = [];
    if (vRem > 0) parts.push('追加で訪問支援を' + vRem + '回お願いしたい予定があります');
    if (oRem > 0) parts.push('追加でオンライン支援を' + oRem + '回お願いしたい予定があります');
    comment = parts.join('。') + '。';
  } else if (rand() < 0.05) {
    // 5%でランダムに「対象月以降」コメントを付与
    var ADVANCE_COMMENTS = [
      '対象月以降の支援予定として、来月にも研究授業前の訪問支援をお願いしたいです。',
      '夏休み中の校内研修支援についても、別途相談させてください。',
      '秋以降のオンライン支援を継続的にお願いしたい予定です。',
      '次年度の年間計画について、別途打ち合わせをお願いしたいです。'
    ];
    comment = ADVANCE_COMMENTS[Math.floor(rand() * ADVANCE_COMMENTS.length)];
  }

  // ICT要望
  var ictRequest = generateIctRequestSample_(rand);

  // 送信日時（対象月の前月15〜25日のランダム時刻）
  var tp = targetMonth.split('-');
  var ty = parseInt(tp[0], 10);
  var tm = parseInt(tp[1], 10);
  var prevMonth = tm - 1, prevYear = ty;
  if (prevMonth === 0) { prevMonth = 12; prevYear--; }
  var submitDate = new Date(prevYear, prevMonth - 1, 15 + (submitIdx % 11), 9 + (submitIdx % 8), (submitIdx * 7) % 60);

  return [
    school.teacherEmail, school.name, school.teacherName, targetMonth,
    supportType, timeSlot,
    v1c1, v1c2, v1c3,
    wantSecond ? 'はい' : 'いいえ',
    supportType2, timeSlot2,
    v2c1, v2c2, v2c3,
    comment, submitDate, ictRequest
  ];
}

// ICT要望サンプル（授業/校務/設定の3カテゴリから1〜4件）
function generateIctRequestSample_(rand) {
  var ICT_SAMPLES = [
    // 授業支援
    { c: '2年生のロイロノートで提出箱の使い方を教えてほしい',           n: '2年担任 山田',   r: '2年1組' },
    { c: '英語の授業でGoogle翻訳の効果的な活用方法を相談したい',         n: '英語科 佐藤',     r: '3年A組' },
    { c: 'プログラミング授業でmicro:bitの設定をサポートしてほしい',      n: '技術科 鈴木',     r: 'PC教室' },
    { c: '社会科でKahoot!を使ったクイズ形式の授業準備を手伝ってほしい',  n: '社会科 田中',     r: '2年B組' },
    { c: '美術の授業でiPadのお絵かきアプリの導入を検討したい',           n: '美術科 中村',     r: '美術室' },
    // 校務支援
    { c: '成績集計のExcel関数（VLOOKUP）の組み方を教えてほしい',         n: '教頭',            r: '職員室' },
    { c: '通知表PDFの一括出力の手順を確認したい',                        n: '教務主任 高橋',   r: '事務室' },
    { c: '出席簿テンプレートのGoogleスプレッドシート化を相談したい',     n: '主任 伊藤',       r: '職員室' },
    { c: '校務支援システムのログイン不具合を確認してほしい',             n: 'ICT担当 渡辺',    r: '職員室' },
    { c: '保護者向け一斉連絡ツールの活用方法をレクチャーしてほしい',     n: '副校長',          r: '会議室' },
    // 設定
    { c: '新しく届いたタブレットの初期設定をしてほしい',                 n: 'ICT担当 佐藤',    r: 'PC教室' },
    { c: '教室のプロジェクターHDMI接続を確認してほしい',                 n: '理科 中村',       r: '理科室' },
    { c: 'Wi-Fi接続が不安定なので調査してほしい',                        n: '情報担当 木村',   r: '体育館' },
    { c: 'プリンタ設定とドライバインストールをお願いしたい',             n: 'ICT担当 林',      r: '職員室' },
    { c: '電子黒板とChromebookのミラーリング設定を確認してほしい',       n: 'ICT担当 山口',    r: '1年3組' }
  ];
  var n = 1 + Math.floor(rand() * 4); // 1〜4件
  var copy = ICT_SAMPLES.slice();
  var items = [];
  for (var i = 0; i < n && copy.length > 0; i++) {
    var idx = Math.floor(rand() * copy.length);
    var it = copy.splice(idx, 1)[0];
    items.push({ content: it.c, name: it.n, room: it.r });
  }
  return JSON.stringify(items);
}

// 平日リスト取得（祝日を除外）
function getWeekdaysInMonth_(year, month) {
  var holidays = ['2026-07-20']; // 海の日（6月は祝日なし、7月は20日）
  var lastDay = new Date(year, month, 0).getDate();
  var days = [];
  for (var d = 1; d <= lastDay; d++) {
    var date = new Date(year, month - 1, d);
    var dow = date.getDay();
    if (dow === 0 || dow === 6) continue;
    var dateStr = year + '-' + ('0' + month).slice(-2) + '-' + ('0' + d).slice(-2);
    if (holidays.indexOf(dateStr) >= 0) continue;
    days.push(dateStr);
  }
  return days;
}

// 候補日3つを重複なくランダムピック
function pick3Dates_(dates, rand) {
  var copy = dates.slice();
  var picks = [];
  for (var i = 0; i < 3 && copy.length > 0; i++) {
    var idx = Math.floor(rand() * copy.length);
    picks.push(copy.splice(idx, 1)[0]);
  }
  return picks;
}

// オンライン時間帯生成（9:00〜16:45の間、1〜3時間、30分刻み）
function pickOnlineTime_(rand) {
  var startSlots = ['09:00','09:30','10:00','10:30','11:00','11:30','13:00','13:30','14:00'];
  var startStr = startSlots[Math.floor(rand() * startSlots.length)];
  var durationMin = [60, 90, 120, 150, 180][Math.floor(rand() * 5)];
  var startMin = parseInt(startStr.split(':')[0], 10) * 60 + parseInt(startStr.split(':')[1], 10);
  var endMin = startMin + durationMin;
  var maxEnd = 16 * 60 + 45;
  if (endMin > maxEnd) endMin = maxEnd;
  if (endMin - startMin < 60) endMin = startMin + 60;
  var endHour = Math.floor(endMin / 60);
  var endMinPart = endMin % 60;
  var endStr = ('0' + endHour).slice(-2) + ':' + ('0' + endMinPart).slice(-2);
  return startStr + '-' + endStr;
}

// 重み付き抽選
function pickWeighted_(weights, randVal) {
  var total = 0;
  for (var i = 0; i < weights.length; i++) total += weights[i].w;
  var r = randVal * total;
  var acc = 0;
  for (var i = 0; i < weights.length; i++) {
    acc += weights[i].w;
    if (r < acc) return weights[i].v;
  }
  return weights[weights.length - 1].v;
}

// シード付き擬似乱数（LCG）
function seededRand_(seed) {
  var s = Math.abs(seed | 0) % 233280;
  if (s === 0) s = 1;
  return function() {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

// SA画面が候補日を読み込めているかを診断（GASエディタで実行→ログ確認）
function diagnoseSAPageQuery() {
  var settings = getSystemSettings_();
  var tm = settings.targetMonth;
  Logger.log('--- settings.targetMonth ---');
  Logger.log('value: ' + JSON.stringify(tm));
  Logger.log('length: ' + (tm ? tm.length : 0));
  Logger.log('charCodes: ' + (tm ? tm.split('').map(function(c){return c.charCodeAt(0);}).join(',') : ''));

  var candidates = getAllCandidates_(tm);
  Logger.log('--- getAllCandidates_(\"' + tm + '\") ---');
  Logger.log('count: ' + candidates.length);
  if (candidates.length > 0) {
    Logger.log('first record email: ' + candidates[0].email);
    Logger.log('first record schoolName: ' + candidates[0].schoolName);
    Logger.log('first record targetMonth: ' + JSON.stringify(candidates[0].targetMonth));
  }

  // 念のため手動フィルタ件数も確認
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_CANDIDATES);
  if (!sheet) { Logger.log('SHEET_CANDIDATES not found'); return; }
  var data = sheet.getDataRange().getValues();
  var match = 0, mismatch = 0, mismatchSamples = [];
  for (var i = 1; i < data.length; i++) {
    var rm = normalizeTargetMonth_(data[i][3]);
    if (rm === tm) match++;
    else {
      mismatch++;
      if (mismatchSamples.length < 3) {
        mismatchSamples.push({
          row: i + 1,
          rawType: data[i][3] instanceof Date ? 'Date' : typeof data[i][3],
          rawString: String(data[i][3]),
          rawCharCodes: String(data[i][3]).split('').map(function(c){return c.charCodeAt(0);}).join(','),
          normalized: rm
        });
      }
    }
  }
  Logger.log('--- Manual filter check ---');
  Logger.log('match: ' + match + ', mismatch: ' + mismatch);
  Logger.log('mismatch samples: ' + JSON.stringify(mismatchSamples, null, 2));
}

// 候補日シートの対象年月・候補日列の実型と件数を診断（GASエディタで実行→ログ確認）
function diagnoseCandidatesSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_CANDIDATES);
  if (!sheet) return { success: false, message: '候補日シートが見つかりません' };
  var data = sheet.getDataRange().getValues();
  var summary = { totalRows: data.length - 1, byTargetMonth: {}, columnTypes: {} };
  if (data.length > 1) {
    var sampleRow = data[1];
    summary.columnTypes = {
      '対象年月(col4)': sampleRow[3] instanceof Date ? 'Date' : typeof sampleRow[3],
      'v1c1(col7)': sampleRow[6] instanceof Date ? 'Date' : typeof sampleRow[6],
      'v2c1(col13)': sampleRow[12] instanceof Date ? 'Date' : typeof sampleRow[12],
      '送信日時(col17)': sampleRow[16] instanceof Date ? 'Date' : typeof sampleRow[16]
    };
    summary.sampleRowMonthRaw = String(sampleRow[3]);
    summary.sampleRowMonthNormalized = normalizeTargetMonth_(sampleRow[3]);
  }
  for (var i = 1; i < data.length; i++) {
    var m = normalizeTargetMonth_(data[i][3]);
    summary.byTargetMonth[m] = (summary.byTargetMonth[m] || 0) + 1;
  }
  Logger.log(JSON.stringify(summary, null, 2));
  return { success: true, summary: summary };
}

// 候補日シートの対象年月・候補日列がDate型で格納されていた場合、yyyy-MM文字列に修復
function repairCandidatesSheetDateColumns() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_CANDIDATES);
  if (!sheet) return { success: false, message: '候補日シートが見つかりません' };
  if (sheet.getLastRow() < 2) return { success: true, message: 'データがありません' };

  var lastRow = sheet.getLastRow();
  var fixedMonth = 0, fixedDates = 0;

  // 対象年月列(4)
  var monthRange = sheet.getRange(2, 4, lastRow - 1, 1);
  var monthVals = monthRange.getValues();
  for (var i = 0; i < monthVals.length; i++) {
    if (monthVals[i][0] instanceof Date) {
      monthVals[i][0] = Utilities.formatDate(monthVals[i][0], 'Asia/Tokyo', 'yyyy-MM');
      fixedMonth++;
    }
  }
  monthRange.setNumberFormat('@');
  SpreadsheetApp.flush();
  monthRange.setValues(monthVals);

  // 候補日列(7-9, 13-15)
  var dateColGroups = [
    { start: 7, count: 3 },
    { start: 13, count: 3 }
  ];
  for (var g = 0; g < dateColGroups.length; g++) {
    var grp = dateColGroups[g];
    var range = sheet.getRange(2, grp.start, lastRow - 1, grp.count);
    var vals = range.getValues();
    var changed = false;
    for (var i = 0; i < vals.length; i++) {
      for (var j = 0; j < vals[i].length; j++) {
        if (vals[i][j] instanceof Date) {
          vals[i][j] = Utilities.formatDate(vals[i][j], 'Asia/Tokyo', 'yyyy-MM-dd');
          fixedDates++;
          changed = true;
        }
      }
    }
    if (changed) {
      range.setNumberFormat('@');
      SpreadsheetApp.flush();
      range.setValues(vals);
    }
  }

  return {
    success: true,
    message: '対象年月 ' + fixedMonth + '件、候補日 ' + fixedDates + '件を文字列に修復しました'
  };
}

// ===== 5月サンプルデータ生成 =====

function setupSampleDataMay2026() {
  // --- 1. システム設定 ---
  var settingsSheet = getOrCreateSheet_(SHEET_SETTINGS, ['設定名', '値']);
  var settingsData = settingsSheet.getDataRange().getValues();
  for (var i = 1; i < settingsData.length; i++) {
    var key = String(settingsData[i][0]).trim();
    if (key === '対象年月') settingsSheet.getRange(i + 1, 2).setNumberFormat('@').setValue('2026-05');
    if (key === '締切日') settingsSheet.getRange(i + 1, 2).setValue('2026-04-25');
    if (key === 'ステータス') settingsSheet.getRange(i + 1, 2).setValue('締切');
  }

  // --- 2. 定例会 ---
  var meetingSheet = getOrCreateSheet_(SHEET_MEETINGS, ['日付', '名称']);
  if (meetingSheet.getLastRow() > 1) {
    meetingSheet.getRange(2, 1, meetingSheet.getLastRow() - 1, 2).clearContent();
  }
  meetingSheet.getRange(2, 1, 1, 2).setValues([['2026-05-15', '5月定例会']]);

  // --- 3. 支援員個別休日（ステータス混在のサンプル） ---
  var staffOffSheet = getOrCreateSheet_(SHEET_STAFF_OFF, STAFF_OFF_HEADERS);
  ensureStaffOffStatusColumns_(staffOffSheet);
  if (staffOffSheet.getLastRow() > 1) {
    staffOffSheet.getRange(2, 1, staffOffSheet.getLastRow() - 1, STAFF_OFF_HEADERS.length).clearContent();
  }
  // [日付, 支援員名, 備考, ステータス, 却下理由, 申請者メール, 申請日時]
  var staffOffData = [
    // 承認済（SA直接追加 or 既承認）
    ['2026-05-12', '仲西 扶由子', '私用',     '承認済', '', '',                          new Date(2026, 3, 18, 10,  0)],
    ['2026-05-08', '平川 和',     '通院',     '承認済', '', '2011icttea@fuku-c.ed.jp',   new Date(2026, 3, 19,  9, 30)],
    ['2026-05-14', '舩越 風音',   '私用',     '承認済', '', '',                          new Date(2026, 3, 20, 11,  0)],
    ['2026-05-13', '友池 はるか', '研修',     '承認済', '', '2014icttea@fuku-c.ed.jp',   new Date(2026, 3, 21,  9, 30)],
    // 申請中（支援員から提出済み・SA未承認）
    ['2026-05-21', '藤林 悠人',   '外部研修', '申請中', '', '2001icttea@fuku-c.ed.jp',   new Date(2026, 3, 24, 14,  0)],
    ['2026-05-18', '木原 あずさ', '校内研修', '申請中', '', '2002icttea@fuku-c.ed.jp',   new Date(2026, 3, 25, 13,  0)],
    // 却下（理由付き）
    ['2026-05-25', '日髙 璃衣子', '私用',     '却下',   '同日に他の支援員も希望しているため再調整をお願いします', '2005icttea@fuku-c.ed.jp', new Date(2026, 3, 22, 16,  0)]
  ];
  staffOffSheet.getRange(2, 1, staffOffData.length, STAFF_OFF_HEADERS.length).setValues(staffOffData);

  // --- 4. 学校マスタから学校一覧取得 ---
  var schoolSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SCHOOLS);
  if (!schoolSheet) return { success: false, message: '学校マスタが見つかりません。先にsetupSchoolMasterを実行してください。' };
  var schoolData = schoolSheet.getDataRange().getValues();
  var allSchools = [];
  for (var i = 1; i < schoolData.length; i++) {
    if (!schoolData[i][0]) continue;
    allSchools.push({
      code: String(schoolData[i][0]).trim(),
      name: String(schoolData[i][1]).trim(),
      staff: String(schoolData[i][2]).trim()
    });
  }

  // --- 5. ユーザー登録（先生データ） ---
  var surnames = ['田中','佐藤','鈴木','高橋','渡辺','伊藤','山本','中村','小林','加��',
    '吉田','山田','松本','井上','木村','林','斎藤','清水','山口','森',
    '池田','橋本','阿部','石川','前田','小川','藤田','岡田','後���','長谷川',
    '村上','近藤','石井','坂本','遠藤','青木','藤井','西村','福田','太田',
    '三浦','岡本','松田','中川','中野','原田','小野','田村','竹内','金子',
    '和田','中山','石田','上田','森田','原','柴田','酒井','工藤','横山',
    '宮崎','宮本','内田','高木','安藤','島田','谷口','大野','高田','丸山'];
  var firstNames = ['太郎','花子','一郎','美咲','健太','裕子','大輔','あゆみ','翔','真由美',
    '拓也','恵子','直樹','智子','雄一','由美','誠','久美���','浩二','幸子',
    '隆','明美','修','京子','正','洋��','豊','節子','博','順子',
    '勝','和子','実','典子','進','弘子','勉','信子','清','敏子'];
  var roles = ['教頭','ICT担当','ICT担当','情報教育担当','ICT担当','教頭','情報教育担当','ICT担当'];

  var userSheet = getOrCreateSheet_(SHEET_USERS, ['メールアドレス', '学校名', '氏名', '担当', '登録日時']);
  if (userSheet.getLastRow() > 1) {
    userSheet.getRange(2, 1, userSheet.getLastRow() - 1, 5).clearContent();
  }

  var userRows = [];
  for (var i = 0; i < allSchools.length; i++) {
    var s = allSchools[i];
    var sn = surnames[i % surnames.length];
    var fn = firstNames[i % firstNames.length];
    var email = 't' + s.code + '@fuku-c.ed.jp';
    var role = roles[i % roles.length];
    var regDate = new Date(2026, 3, 10 + (i % 15)); // 4月10日〜24日にランダム���録
    userRows.push([email, s.name, sn + ' ' + fn, role, regDate]);
    allSchools[i].teacherEmail = email;
    allSchools[i].teacherName = sn + ' ' + fn;
  }
  userSheet.getRange(2, 1, userRows.length, 5).setValues(userRows);

  // --- 6. 候補日データ ---
  // 5月の稼働��
  var earlyDays = ['2026-05-01','2026-05-07','2026-05-08','2026-05-11','2026-05-12',
    '2026-05-13','2026-05-14','2026-05-18','2026-05-19','2026-05-20'];
  var lateDays = ['2026-05-11','2026-05-12','2026-05-13','2026-05-14','2026-05-18',
    '2026-05-19','2026-05-20','2026-05-21','2026-05-22','2026-05-25',
    '2026-05-26','2026-05-27','2026-05-28','2026-05-29'];
  var allWorkDays = ['2026-05-01','2026-05-07','2026-05-08','2026-05-11','2026-05-12',
    '2026-05-13','2026-05-14','2026-05-18','2026-05-19','2026-05-20',
    '2026-05-21','2026-05-22','2026-05-25','2026-05-26','2026-05-27',
    '2026-05-28','2026-05-29'];

  var candidateHeaders = [
    'メールアドレス','学校名','氏名','対象年月',
    '1回目_第1候補','1回目_第2候補','1回目_第3候補',
    '2回目_第1候補','2回目_第2候補','2回目_第3候補',
    '3回目希望','3回目_第1候補','3回目_第2候補','3回目_第3候補',
    '訪問減対応','備考','送信日時','ICT支援要望'
  ];
  var candSheet = getOrCreateSheet_(SHEET_CANDIDATES, candidateHeaders);

  if (candSheet.getLastRow() > 1) {
    candSheet.getRange(2, 1, candSheet.getLastRow() - 1, candidateHeaders.length).clearContent();
  }

  // ICT支援要望サンプル（5月：年度始め・新入生対応・年間計画）
  var ictRequestSamples = [
    '生徒のChromebookでGoogle Classroomへのログインが不安定な端末があるため、原因確認をお願いします。',
    '電子黒板とタブレットのミラーリングがうまくいかないので操作方法を教えてほしいです。',
    'Google Formsを使った定期テストの自動採点設定を一緒に作っていただきたいです。',
    'プログラミング教育の年間計画について相談したいです。',
    '校務支援システムへのログイン不具合が複数発生しているので調査をお願いします。',
    '保護者向け一斉メール配信ツールの活用方法をレクチャーしてほしいです。',
    '新入生のアカウント発行で一部設定エラーが出ているため確認をお願いします。',
    '職員室のプリンタとChromebookの印刷設定をお願いします。',
    'Google Classroomのクラス作成で名簿一括取り込みの方法を教えてください。',
    'iPadのMDM管理プロファイルが反映されない端末があるので確認をお願いします。',
    '',
    '新年度で職員のGoogleドライブ容量が逼迫しているので整理方法を相談したいです。',
    '電子黒板のWi-Fi接続が不安定なため設定確認をお願いします。',
    '生徒用タブレットの初期設定をクラス単位で一括できないか相談したいです。',
    'YouTubeフィルタリング設定で授業に必要な動画が視聴できないため調整をお願いします。',
    '部活動の動画記録をクラウドで共有する仕組みを整えたいです。'
  ];

  // ���易乱数（シード的に添字を使う）
  function pick(arr, seed) { return arr[seed % arr.length]; }
  function pickN(arr, n, seed) {
    var copy = arr.slice();
    var result = [];
    for (var j = 0; j < n && copy.length > 0; j++) {
      var idx = (seed + j * 7) % copy.length;
      result.push(copy.splice(idx, 1)[0]);
    }
    return result;
  }

  var candRows = [];
  var NO_PREF = '特に指定しない';

  for (var i = 0; i < allSchools.length; i++) {
    var s = allSchools[i];

    // パターン分け（7校は未提出）
    if (i % 11 === 10) continue; // 約7校が未提出

    var pattern = i % 8; // 8パターンのバリエーション
    var v1c1, v1c2, v1c3, v2c1, v2c2, v2c3;
    var wantThird = 'いいえ';
    var v3c1 = '', v3c2 = '', v3c3 = '';
    var reducePolicy = '振替可';
    var comment = '';
    var ictRequest = ictRequestSamples[i % ictRequestSamples.length];

    // 1回目候補（通常は前半）
    var v1picks = pickN(earlyDays, 3, i * 3 + 1);

    // 2回目候補（通常は後半）
    var v2picks = pickN(lateDays, 3, i * 5 + 2);

    switch (pattern) {
      case 0: // 全候補指定・標準
        v1c1 = v1picks[0]; v1c2 = v1picks[1]; v1c3 = v1picks[2];
        v2c1 = v2picks[0]; v2c2 = v2picks[1]; v2c3 = v2picks[2];
        break;

      case 1: // 第1候補のみ、残りは「特に指定しない」
        v1c1 = v1picks[0]; v1c2 = NO_PREF; v1c3 = NO_PREF;
        v2c1 = v2picks[0]; v2c2 = NO_PREF; v2c3 = NO_PREF;
        break;

      case 2: // 全候補指定＋3回目希望あり
        v1c1 = v1picks[0]; v1c2 = v1picks[1]; v1c3 = v1picks[2];
        v2c1 = v2picks[0]; v2c2 = v2picks[1]; v2c3 = v2picks[2];
        wantThird = 'はい';
        var v3picks = pickN(allWorkDays, 3, i * 7 + 3);
        v3c1 = v3picks[0]; v3c2 = v3picks[1]; v3c3 = v3picks[2];
        break;

      case 3: // 第1・第2候補のみ
        v1c1 = v1picks[0]; v1c2 = v1picks[1]; v1c3 = NO_PREF;
        v2c1 = v2picks[0]; v2c2 = v2picks[1]; v2c3 = NO_PREF;
        comment = '5月は行事が多いため柔軟に対応します';
        break;

      case 4: // 全候補指定＋2回必須
        v1c1 = v1picks[0]; v1c2 = v1picks[1]; v1c3 = v1picks[2];
        v2c1 = v2picks[0]; v2c2 = v2picks[1]; v2c3 = v2picks[2];
        reducePolicy = '2回必須';
        comment = '研究授業の準備があるため2回の訪問を希望します';
        break;

      case 5: // ルール違反：1回目に下旬を指定
        var latePicksForV1 = pickN(lateDays, 3, i * 4 + 5);
        v1c1 = latePicksForV1[0]; v1c2 = latePicksForV1[1]; v1c3 = NO_PREF;
        v2c1 = v2picks[0]; v2c2 = v2picks[1]; v2c3 = v2picks[2];
        comment = '月の前半は出張が多いため後半希望です';
        break;

      case 6: // 全候補指定＋備考あり
        v1c1 = v1picks[0]; v1c2 = v1picks[1]; v1c3 = v1picks[2];
        v2c1 = v2picks[0]; v2c2 = v2picks[1]; v2c3 = v2picks[2];
        comment = '��月に関しては、月の前半部分に2回訪問が希望です';
        break;

      case 7: // 3回目希望＋備考
        v1c1 = v1picks[0]; v1c2 = v1picks[1]; v1c3 = v1picks[2];
        v2c1 = v2picks[0]; v2c2 = v2picks[1]; v2c3 = v2picks[2];
        wantThird = 'はい';
        var v3picks2 = pickN(allWorkDays, 3, i * 9 + 1);
        v3c1 = v3picks2[0]; v3c2 = v3picks2[1]; v3c3 = NO_PREF;
        comment = 'タブレット導入の相談をしたいです';
        break;
    }

    // 送信日時（4月15日〜25日にランダム）
    var submitDate = new Date(2026, 3, 15 + (i % 11), 9 + (i % 8), (i * 7) % 60);

    candRows.push([
      s.teacherEmail, s.name, s.teacherName, '2026-05',
      v1c1, v1c2, v1c3, v2c1, v2c2, v2c3,
      wantThird, v3c1, v3c2, v3c3,
      reducePolicy, comment, submitDate, ictRequest
    ]);
  }

  if (candRows.length > 0) {
    var candRange = candSheet.getRange(2, 1, candRows.length, candidateHeaders.length);
    // 対象年月(4列目)と候補日列(5〜14列目)を文字列フォーマットにして日付自動変換を防ぐ
    candSheet.getRange(2, 4, candRows.length, 11).setNumberFormat('@');
    candRange.setValues(candRows);
  }

  // --- 7. 全体休日（GW用、既に祝日はクライアント側にあるが念のためお盆等を登録） ---
  var holidaySheet = getOrCreateSheet_(SHEET_HOLIDAYS, ['日付', '名称']);
  if (holidaySheet.getLastRow() > 1) {
    holidaySheet.getRange(2, 1, holidaySheet.getLastRow() - 1, 2).clearContent();
  }
  // 5月は祝日がシ���テム内蔵なので追加の特別休日は不要だが、���として1件
  holidaySheet.getRange(2, 1, 1, 2).setValues([['2026-05-01', 'GW期間（任意休暇推奨日）']]);

  return {
    success: true,
    message: 'サンプルデータ生成完了: ユーザ��' + userRows.length + '名、候補日' + candRows.length + '件、支援員休日' + staffOffData.length + '件'
  };
}

// ===== スケジュール管理 =====

function getScheduleData(targetMonth) {
  return getSchedule_(targetMonth);
}

function getSchedule_(targetMonth) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_SCHEDULE);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  var results = [];
  for (var i = 1; i < data.length; i++) {
    var month = String(data[i][0]).trim();
    if (targetMonth && month !== targetMonth) continue;
    results.push({
      targetMonth: month,
      date: String(data[i][1]).trim(),
      staffName: String(data[i][2]).trim(),
      schoolName: String(data[i][3]).trim(),
      candidateRank: String(data[i][4]).trim(),
      status: String(data[i][5]).trim(),
      origStaff: String(data[i][6] || '').trim()
    });
  }
  return results;
}

function saveScheduleEntry(entry) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var headers = ['対象年月', '日付', '支援員名', '学校名', '候補順位', 'ステータス', '元担当支援員'];
  var sheet = getOrCreateSheet_(SHEET_SCHEDULE, headers);
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, 7).setNumberFormat('@').setValues([[
    entry.targetMonth, entry.date, entry.staffName, entry.schoolName,
    entry.candidateRank || '', entry.status || '仮', entry.origStaff || ''
  ]]);
  return { success: true };
}

function updateScheduleEntry(oldDate, oldStaff, newDate, newSchool, targetMonth) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_SCHEDULE);
  if (!sheet) return { success: false, message: 'スケジュールシートが見つかりません' };
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]).trim() === targetMonth &&
        String(data[i][1]).trim() === oldDate &&
        String(data[i][2]).trim() === oldStaff) {
      if (newSchool === '') {
        sheet.deleteRow(i + 1);
      } else {
        sheet.getRange(i + 1, 2).setNumberFormat('@').setValue(newDate);
        sheet.getRange(i + 1, 4).setValue(newSchool);
        sheet.getRange(i + 1, 6).setValue('手動調整');
      }
      return { success: true };
    }
  }
  return { success: false, message: '該当エントリが見つかりません' };
}

function deleteScheduleEntry(date, staffName, targetMonth) {
  return updateScheduleEntry(date, staffName, '', '', targetMonth);
}

function confirmSchedule(targetMonth) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_SCHEDULE);
  if (!sheet) return { success: false, message: 'スケジュールシートが見つかりません' };
  var data = sheet.getDataRange().getValues();
  var count = 0;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === targetMonth) {
      sheet.getRange(i + 1, 6).setValue('確定');
      count++;
    }
  }
  return { success: true, message: count + '件のスケジュールを確定しました' };
}

function unconfirmSchedule(targetMonth) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_SCHEDULE);
  if (!sheet) return { success: false, message: 'スケジュールシートが見つかりません' };
  var data = sheet.getDataRange().getValues();
  var count = 0;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === targetMonth && String(data[i][5]).trim() === '確定') {
      sheet.getRange(i + 1, 6).setValue('仮');
      count++;
    }
  }
  return { success: true, message: count + '件の確定を解除しました' };
}

function getConfirmedScheduleForStaff(targetMonth, email) {
  var schedule = getSchedule_(targetMonth);
  var confirmed = schedule.filter(function(s) { return s.status === '確定'; });

  // メールから支援員名を特定（支援員マスタまたは学校マスタ）
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var staffSheet = ss.getSheetByName(SHEET_STAFF);
  var staffName = '';
  if (staffSheet) {
    var staffData = staffSheet.getDataRange().getValues();
    for (var i = 1; i < staffData.length; i++) {
      if (String(staffData[i][0]).trim() === email) { staffName = String(staffData[i][1]).trim(); break; }
    }
  }

  // 学校マスタの支援員メールからも検索
  if (!staffName) {
    var schoolSheet = ss.getSheetByName(SHEET_SCHOOLS);
    if (schoolSheet) {
      var schoolData = schoolSheet.getDataRange().getValues();
      for (var i = 1; i < schoolData.length; i++) {
        if (String(schoolData[i][3]).trim() === email) {
          staffName = String(schoolData[i][2]).trim();
          break;
        }
      }
    }
  }

  if (!staffName) return { staffName: '', schedule: [] };

  // 自分が担当 or 自分が代行する予定
  var mySchedule = confirmed.filter(function(s) {
    return s.staffName === staffName || s.origStaff === staffName;
  });

  return { staffName: staffName, schedule: mySchedule };
}

function getConfirmedScheduleForSchool(targetMonth, schoolName) {
  var schedule = getSchedule_(targetMonth);
  return schedule.filter(function(s) {
    return s.status === '確定' && s.schoolName === schoolName;
  });
}

// ===== 優先スコア =====

function getPriorityScores_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_PRIORITY);
  if (!sheet) return {};
  var data = sheet.getDataRange().getValues();
  var scores = {};
  for (var i = 1; i < data.length; i++) {
    var school = String(data[i][0]).trim();
    if (school) scores[school] = Number(data[i][1]) || 0;
  }
  return scores;
}

function savePriorityScores_(scores) {
  var headers = ['学校名', 'スコア', '理由', '更新日'];
  var sheet = getOrCreateSheet_(SHEET_PRIORITY, headers);
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).clearContent();
  }
  var rows = [];
  for (var school in scores) {
    if (scores[school] > 0) {
      rows.push([school, scores[school], '前月の候補順位による加算', new Date()]);
    }
  }
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 4).setValues(rows);
  }
}

// ===== 自動スケジュール割り当て =====

function autoAssignSchedule() {
  var settings = getSystemSettings_();
  var targetMonth = settings.targetMonth;
  if (!targetMonth) return { success: false, message: '対象年月が設定されていません' };

  var candidates = getAllCandidates_(targetMonth);
  if (candidates.length === 0) return { success: false, message: '候補日データがありません' };

  var schools = getAllSchools_();
  var holidays = getHolidays_();
  var meetings = getMeetings_();
  var staffOffList = getStaffOff_().filter(function(s) { return s.status === '承認済'; });
  var priorityScores = getPriorityScores_();

  // --- 1. 稼働不可日マップ ---
  var globalOffDates = {};
  // 祝日（ハードコード）
  var jpHolidays = {
    '2026-01-01':1,'2026-01-12':1,'2026-02-11':1,'2026-02-23':1,'2026-03-20':1,
    '2026-04-29':1,'2026-05-03':1,'2026-05-04':1,'2026-05-05':1,'2026-05-06':1,
    '2026-07-20':1,'2026-08-11':1,'2026-09-21':1,'2026-09-23':1,'2026-10-12':1,
    '2026-11-03':1,'2026-11-23':1,'2027-01-01':1,'2027-01-11':1,'2027-02-11':1,
    '2027-02-23':1,'2027-03-21':1
  };
  for (var d in jpHolidays) globalOffDates[d] = true;
  for (var i = 0; i < holidays.length; i++) globalOffDates[holidays[i].date] = true;
  for (var i = 0; i < meetings.length; i++) globalOffDates[meetings[i].date] = true;

  // 支援員別休日
  var staffOffMap = {};
  for (var i = 0; i < staffOffList.length; i++) {
    var sn = staffOffList[i].staffName;
    if (!staffOffMap[sn]) staffOffMap[sn] = {};
    staffOffMap[sn][staffOffList[i].date] = true;
  }

  // --- 2. 月の稼働日一覧 ---
  var parts = targetMonth.split('-');
  var year = parseInt(parts[0], 10);
  var month = parseInt(parts[1], 10);
  var lastDay = new Date(year, month, 0).getDate();
  var allWorkDays = [];
  for (var d = 1; d <= lastDay; d++) {
    var ds = year + '-' + String(month).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    var dow = new Date(year, month - 1, d).getDay();
    if (dow === 0 || dow === 6) continue;
    if (globalOffDates[ds]) continue;
    allWorkDays.push(ds);
  }

  // 支援員ごとの稼働日
  function getStaffWorkDays(staffName) {
    var off = staffOffMap[staffName] || {};
    return allWorkDays.filter(function(d) { return !off[d]; });
  }

  // --- 3. 学校→支援員マッピング ---
  var schoolStaffMap = {};
  for (var i = 0; i < schools.length; i++) {
    schoolStaffMap[schools[i].schoolName] = schools[i].staffName;
  }

  // --- 4. 候補日を支援員別に整理 ---
  var staffSchoolCandidates = {}; // { staffName: [ {school, v1candidates, v2candidates, ...} ] }
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    var staff = schoolStaffMap[c.schoolName];
    if (!staff) continue;
    if (!staffSchoolCandidates[staff]) staffSchoolCandidates[staff] = [];

    var v1 = [c.v1c1, c.v1c2, c.v1c3].filter(function(v) { return v && v !== '特に指定しない' && v !== 'undefined'; });
    var v2 = [c.v2c1, c.v2c2, c.v2c3].filter(function(v) { return v && v !== '特に指定しない' && v !== 'undefined'; });
    var v3 = [];
    if (c.wantThird) {
      v3 = [c.v3c1, c.v3c2, c.v3c3].filter(function(v) { return v && v !== '特に指定しない' && v !== 'undefined'; });
    }

    staffSchoolCandidates[staff].push({
      schoolName: c.schoolName,
      v1: v1,
      v2: v2,
      v3: v3,
      wantThird: c.wantThird,
      reducePolicy: c.reducePolicy,
      priority: priorityScores[c.schoolName] || 0
    });
  }

  // --- 5. 割り当てアルゴリズム ---
  var scheduleRows = [];
  var newPriorityScores = {};

  for (var staffName in staffSchoolCandidates) {
    var workDays = getStaffWorkDays(staffName);
    var usedDays = {}; // 日付 → 使用済み
    var schoolList = staffSchoolCandidates[staffName];

    // 優先スコアが高い学校を先に処理
    schoolList.sort(function(a, b) { return b.priority - a.priority; });

    var schoolAssignments = []; // { schoolName, visit1Date, visit1Rank, visit2Date, visit2Rank }

    // --- Visit 1 割り当て ---
    for (var si = 0; si < schoolList.length; si++) {
      var sc = schoolList[si];
      var assigned = false;

      // 第1〜第3候補を順に試す
      for (var ci = 0; ci < sc.v1.length; ci++) {
        var date = sc.v1[ci];
        if (workDays.indexOf(date) !== -1 && !usedDays[date]) {
          usedDays[date] = true;
          schoolAssignments.push({ schoolName: sc.schoolName, visit1Date: date, visit1Rank: '第' + (ci + 1) + '候補' });
          assigned = true;
          break;
        }
      }

      // 候補日がすべて埋まっていたら空いている日から割り当て
      if (!assigned) {
        for (var wi = 0; wi < workDays.length; wi++) {
          if (!usedDays[workDays[wi]]) {
            usedDays[workDays[wi]] = true;
            schoolAssignments.push({ schoolName: sc.schoolName, visit1Date: workDays[wi], visit1Rank: '自動割当' });
            assigned = true;
            // 優先スコア加算（候補外に割り当てられた）
            newPriorityScores[sc.schoolName] = (newPriorityScores[sc.schoolName] || 0) + 2;
            break;
          }
        }
      }

      if (!assigned) {
        schoolAssignments.push({ schoolName: sc.schoolName, visit1Date: '', visit1Rank: '割当不可' });
      }
    }

    // --- Visit 2 割り当て（Visit 1から5日以上空ける） ---
    for (var si = 0; si < schoolAssignments.length; si++) {
      var sa = schoolAssignments[si];
      var sc = schoolList[si];
      var v1Date = sa.visit1Date;
      var assigned = false;

      function dayDiff(d1, d2) {
        return Math.abs((new Date(d1) - new Date(d2)) / 86400000);
      }

      // 第1〜第3候補を順に試す（5日以上間隔）
      for (var ci = 0; ci < sc.v2.length; ci++) {
        var date = sc.v2[ci];
        if (workDays.indexOf(date) !== -1 && !usedDays[date] && (!v1Date || dayDiff(v1Date, date) >= 5)) {
          usedDays[date] = true;
          sa.visit2Date = date;
          sa.visit2Rank = '第' + (ci + 1) + '候補';
          assigned = true;
          break;
        }
      }

      if (!assigned) {
        // 空いている日で5日以上離れた日を探す
        for (var wi = 0; wi < workDays.length; wi++) {
          var wd = workDays[wi];
          if (!usedDays[wd] && (!v1Date || dayDiff(v1Date, wd) >= 5)) {
            usedDays[wd] = true;
            sa.visit2Date = wd;
            sa.visit2Rank = '自動割当';
            newPriorityScores[sc.schoolName] = (newPriorityScores[sc.schoolName] || 0) + 1;
            assigned = true;
            break;
          }
        }
      }

      // 5日間隔が無理なら3日以上で妥協
      if (!assigned) {
        for (var wi = 0; wi < workDays.length; wi++) {
          var wd = workDays[wi];
          if (!usedDays[wd] && (!v1Date || dayDiff(v1Date, wd) >= 3)) {
            usedDays[wd] = true;
            sa.visit2Date = wd;
            sa.visit2Rank = '自動割当(間隔短)';
            assigned = true;
            break;
          }
        }
      }

      if (!assigned) {
        sa.visit2Date = '';
        sa.visit2Rank = '割当不可';
      }
    }

    // --- Visit 3（希望校のみ、余りの日がある場合） ---
    for (var si = 0; si < schoolAssignments.length; si++) {
      var sa = schoolAssignments[si];
      var sc = schoolList[si];
      if (!sc.wantThird) continue;

      var v1 = sa.visit1Date;
      var v2 = sa.visit2Date;
      var assigned = false;

      for (var ci = 0; ci < sc.v3.length; ci++) {
        var date = sc.v3[ci];
        if (workDays.indexOf(date) !== -1 && !usedDays[date] &&
            (!v1 || dayDiff(v1, date) >= 3) && (!v2 || dayDiff(v2, date) >= 3)) {
          usedDays[date] = true;
          sa.visit3Date = date;
          sa.visit3Rank = '第' + (ci + 1) + '候補';
          assigned = true;
          break;
        }
      }

      if (!assigned) {
        for (var wi = 0; wi < workDays.length; wi++) {
          var wd = workDays[wi];
          if (!usedDays[wd] && (!v1 || dayDiff(v1, wd) >= 3) && (!v2 || dayDiff(v2, wd) >= 3)) {
            usedDays[wd] = true;
            sa.visit3Date = wd;
            sa.visit3Rank = '自動割当';
            assigned = true;
            break;
          }
        }
      }
    }

    // --- 結果をまとめる ---
    for (var si = 0; si < schoolAssignments.length; si++) {
      var sa = schoolAssignments[si];
      if (sa.visit1Date) {
        scheduleRows.push([targetMonth, sa.visit1Date, staffName, sa.schoolName, '1回目 ' + sa.visit1Rank, '仮', '']);
      }
      if (sa.visit2Date) {
        scheduleRows.push([targetMonth, sa.visit2Date, staffName, sa.schoolName, '2回目 ' + sa.visit2Rank, '仮', '']);
      }
      if (sa.visit3Date) {
        scheduleRows.push([targetMonth, sa.visit3Date, staffName, sa.schoolName, '3回目 ' + sa.visit3Rank, '仮', '']);
      }

      // 第2候補以降で決まった学校は来月の優先スコアに加算
      if (sa.visit1Rank && sa.visit1Rank.indexOf('第1') === -1 && sa.visit1Rank !== '割当不可') {
        newPriorityScores[sa.schoolName] = (newPriorityScores[sa.schoolName] || 0) + 1;
      }
      if (sa.visit2Rank && sa.visit2Rank.indexOf('第1') === -1 && sa.visit2Rank !== '割当不可') {
        newPriorityScores[sa.schoolName] = (newPriorityScores[sa.schoolName] || 0) + 1;
      }
    }
  }

  // --- 6. スケジュールシートに書き込み ---
  var headers = ['対象年月', '日付', '支援員名', '学校名', '候補順位', 'ステータス', '元担当支援員'];
  var sheet = getOrCreateSheet_(SHEET_SCHEDULE, headers);

  // 対象月の既存データをクリア
  var existing = sheet.getDataRange().getValues();
  for (var i = existing.length - 1; i >= 1; i--) {
    if (String(existing[i][0]).trim() === targetMonth) {
      sheet.deleteRow(i + 1);
    }
  }

  if (scheduleRows.length > 0) {
    // 日付順にソート
    scheduleRows.sort(function(a, b) { return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0; });
    var insertRange = sheet.getRange(sheet.getLastRow() + 1, 1, scheduleRows.length, 7);
    insertRange.setNumberFormat('@');
    insertRange.setValues(scheduleRows);
  }

  // 優先スコアを保存
  savePriorityScores_(newPriorityScores);

  // 統計
  var v1Count = scheduleRows.filter(function(r) { return r[4].indexOf('1回目') !== -1; }).length;
  var v2Count = scheduleRows.filter(function(r) { return r[4].indexOf('2回目') !== -1; }).length;
  var v3Count = scheduleRows.filter(function(r) { return r[4].indexOf('3回目') !== -1; }).length;

  return {
    success: true,
    message: 'スケジュール割り当て完了: 1回目=' + v1Count + '件, 2回目=' + v2Count + '件, 3回目=' + v3Count + '件（合計' + scheduleRows.length + '件）'
  };
}

// ===== レビュー用機能 =====

function resetAllData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetNames = [SHEET_USERS, SHEET_CANDIDATES, SHEET_SCHEDULE, SHEET_PRIORITY,
                    SHEET_HOLIDAYS, SHEET_MEETINGS, SHEET_STAFF_OFF];
  for (var i = 0; i < sheetNames.length; i++) {
    var sheet = ss.getSheetByName(sheetNames[i]);
    if (sheet && sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
    }
  }
  // システム設定をリセット
  var settingsSheet = ss.getSheetByName(SHEET_SETTINGS);
  if (settingsSheet) {
    var data = settingsSheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var key = String(data[i][0]).trim();
      if (key === '対象年月') settingsSheet.getRange(i + 1, 2).setNumberFormat('@').setValue('');
      if (key === '締切日') settingsSheet.getRange(i + 1, 2).setValue('');
      if (key === 'ステータス') settingsSheet.getRange(i + 1, 2).setValue('');
    }
  }
  return { success: true, message: '全データを初期化しました' };
}

function setupSampleDataJune2026() {
  // 5月のスケジュールが確定済みであることを前提とする
  // まず5月実績から優先スコアを更新（既にautoAssignで計算済みのはず）

  // --- 1. システム設定を6月に更新 ---
  var settingsSheet = getOrCreateSheet_(SHEET_SETTINGS, ['設定名', '値']);
  var settingsData = settingsSheet.getDataRange().getValues();
  for (var i = 1; i < settingsData.length; i++) {
    var key = String(settingsData[i][0]).trim();
    if (key === '対象年月') settingsSheet.getRange(i + 1, 2).setNumberFormat('@').setValue('2026-06');
    if (key === '締切日') settingsSheet.getRange(i + 1, 2).setValue('2026-05-25');
    if (key === 'ステータス') settingsSheet.getRange(i + 1, 2).setValue('締切');
  }

  // --- 2. 支援員休日（6月分・ステータス混在） ---
  var staffOffSheet = getOrCreateSheet_(SHEET_STAFF_OFF, STAFF_OFF_HEADERS);
  ensureStaffOffStatusColumns_(staffOffSheet);
  // 5月分を残しつつ6月分を追加
  // [日付, 支援員名, 備考, ステータス, 却下理由, 申請者メール, 申請日時]
  var staffOffData = [
    ['2026-06-05', '仲西 扶由子', '私用',     '承認済', '', '',                        new Date(2026, 4, 16, 10,  0)],
    ['2026-06-10', '舩越 風音',   '通院',     '承認済', '', '2010icttea@fuku-c.ed.jp', new Date(2026, 4, 17,  9, 30)],
    ['2026-06-19', '木原 あずさ', '校内研修', '承認済', '', '2002icttea@fuku-c.ed.jp', new Date(2026, 4, 18, 14,  0)],
    // 申請中
    ['2026-06-23', '藤林 悠人',   '私用',     '申請中', '', '2001icttea@fuku-c.ed.jp', new Date(2026, 4, 22, 11,  0)],
    ['2026-06-25', '友池 はるか', '私用',     '申請中', '', '2014icttea@fuku-c.ed.jp', new Date(2026, 4, 23, 13, 30)],
    // 却下
    ['2026-06-12', '中山 拓也',   '出張',     '却下',   '6月は別予定で稼働日が少ないため再検討をお願いします', '2008icttea@fuku-c.ed.jp', new Date(2026, 4, 20, 15,  0)]
  ];
  for (var i = 0; i < staffOffData.length; i++) {
    staffOffSheet.appendRow(staffOffData[i]);
  }

  // --- 3. 定例会（6月分） ---
  var meetingSheet = getOrCreateSheet_(SHEET_MEETINGS, ['日付', '名称']);
  meetingSheet.appendRow(['2026-06-19', '6月定例会']);

  // --- 4. 候補日データ（6月分） ---
  var schoolSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SCHOOLS);
  var schoolData = schoolSheet.getDataRange().getValues();
  var allSchools = [];
  for (var i = 1; i < schoolData.length; i++) {
    if (!schoolData[i][0]) continue;
    allSchools.push({ code: String(schoolData[i][0]).trim(), name: String(schoolData[i][1]).trim() });
  }

  // ユーザーデータから教師メール取得
  var userSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_USERS);
  var userData = userSheet.getDataRange().getValues();
  var userMap = {};
  for (var i = 1; i < userData.length; i++) {
    userMap[String(userData[i][1]).trim()] = { email: String(userData[i][0]).trim(), name: String(userData[i][2]).trim() };
  }

  var earlyDays = ['2026-06-01','2026-06-02','2026-06-03','2026-06-04','2026-06-05',
    '2026-06-08','2026-06-09','2026-06-10','2026-06-11','2026-06-12',
    '2026-06-15','2026-06-16','2026-06-17','2026-06-18'];
  var lateDays = ['2026-06-11','2026-06-12','2026-06-15','2026-06-16','2026-06-17',
    '2026-06-18','2026-06-22','2026-06-23','2026-06-24','2026-06-25',
    '2026-06-26','2026-06-29','2026-06-30'];
  var allWorkDays = ['2026-06-01','2026-06-02','2026-06-03','2026-06-04','2026-06-05',
    '2026-06-08','2026-06-09','2026-06-10','2026-06-11','2026-06-12',
    '2026-06-15','2026-06-16','2026-06-17','2026-06-18',
    '2026-06-22','2026-06-23','2026-06-24','2026-06-25',
    '2026-06-26','2026-06-29','2026-06-30'];

  var candidateHeaders = [
    'メールアドレス','学校名','氏名','対象年月',
    '1回目_第1候補','1回目_第2候補','1回目_第3候補',
    '2回目_第1候補','2回目_第2候補','2回目_第3候補',
    '3回目希望','3回目_第1候補','3回目_第2候補','3回目_第3候補',
    '訪問減対応','備考','送信日時','ICT支援要望'
  ];
  var candSheet = getOrCreateSheet_(SHEET_CANDIDATES, candidateHeaders);


  // ICT支援要望サンプル（6月：水泳指導・期末テスト・研究授業）
  var ictRequestSamples = [
    '校内のWi-Fiが特定教室で不安定なので、APの確認と再設定をお願いします。',
    'Google Driveの共有設定がうまくいっていないので、職員間の共有ルールを整理したいです。',
    '生徒用アカウントのパスワード再発行を一括で行いたいです。',
    'ロイロノート・スクールの操作研修を職員向けに実施してもらえると助かります。',
    '電子黒板の起動が遅い教室があるので、確認をお願いします。',
    'プリンタへのスキャン送信ができない端末があり、原因調査をお願いします。',
    '期末テストの分析・集計で使えるGoogleシート関数を教えてほしいです。',
    '校内ネットワーク経由で動画教材を配信する方法を相談したいです。',
    '研究授業に向けてGoogle Slidesの共同編集機能の使い方を教えてほしいです。',
    '校務支援システムから出席簿のExcel出力で文字化けが起きているため対応をお願いします。',
    '',
    '体育祭の動画撮影と編集、共有方法について相談したいです。',
    '保健室のオンライン健康観察フォームの集計方法を整理したいです。',
    '生徒のChromebookで一部アプリが起動しない問題が出ているので調査をお願いします。',
    '夏休みに向けたデジタル教材のクラウド整理方法を相談したいです。',
    'Kahoot!やQuizletを授業で使うための初期設定を相談したいです。'
  ];

  function pick(arr, seed) { return arr[seed % arr.length]; }
  function pickN(arr, n, seed) {
    var copy = arr.slice();
    var result = [];
    for (var j = 0; j < n && copy.length > 0; j++) {
      var idx = (seed + j * 7) % copy.length;
      result.push(copy.splice(idx, 1)[0]);
    }
    return result;
  }

  var NO_PREF = '特に指定しない';
  var candRows = [];

  for (var i = 0; i < allSchools.length; i++) {
    var s = allSchools[i];
    var user = userMap[s.name];
    if (!user) continue;
    if (i % 13 === 12) continue; // 数校は未提出

    var pattern = (i + 3) % 8;
    var v1picks = pickN(earlyDays, 3, i * 4 + 2);
    var v2picks = pickN(lateDays, 3, i * 6 + 3);
    var v1c1, v1c2, v1c3, v2c1, v2c2, v2c3;
    var wantThird = 'いいえ', v3c1 = '', v3c2 = '', v3c3 = '';
    var reducePolicy = '振替可', comment = '';
    var ictRequest = ictRequestSamples[i % ictRequestSamples.length];

    switch (pattern) {
      case 0: v1c1=v1picks[0]; v1c2=v1picks[1]; v1c3=v1picks[2]; v2c1=v2picks[0]; v2c2=v2picks[1]; v2c3=v2picks[2]; break;
      case 1: v1c1=v1picks[0]; v1c2=NO_PREF; v1c3=NO_PREF; v2c1=v2picks[0]; v2c2=NO_PREF; v2c3=NO_PREF; break;
      case 2:
        v1c1=v1picks[0]; v1c2=v1picks[1]; v1c3=v1picks[2]; v2c1=v2picks[0]; v2c2=v2picks[1]; v2c3=v2picks[2];
        wantThird='はい'; var v3p=pickN(allWorkDays,3,i*8+4); v3c1=v3p[0]; v3c2=v3p[1]; v3c3=v3p[2]; break;
      case 3: v1c1=v1picks[0]; v1c2=v1picks[1]; v1c3=NO_PREF; v2c1=v2picks[0]; v2c2=v2picks[1]; v2c3=NO_PREF; comment='期末テスト期間は避けてほしい'; break;
      case 4: v1c1=v1picks[0]; v1c2=v1picks[1]; v1c3=v1picks[2]; v2c1=v2picks[0]; v2c2=v2picks[1]; v2c3=v2picks[2]; reducePolicy='2回必須'; comment='プログラミング授業の準備で2回必要'; break;
      case 5:
        var lp=pickN(lateDays,3,i*5+6); v1c1=lp[0]; v1c2=lp[1]; v1c3=NO_PREF;
        v2c1=v2picks[0]; v2c2=v2picks[1]; v2c3=v2picks[2]; comment='前半は行事のため後半希望'; break;
      case 6: v1c1=v1picks[0]; v1c2=v1picks[1]; v1c3=v1picks[2]; v2c1=v2picks[0]; v2c2=v2picks[1]; v2c3=v2picks[2]; comment='6月は水泳指導開始のためICT活用相談希望'; break;
      case 7:
        v1c1=v1picks[0]; v1c2=v1picks[1]; v1c3=v1picks[2]; v2c1=v2picks[0]; v2c2=v2picks[1]; v2c3=v2picks[2];
        wantThird='はい'; var v3p2=pickN(allWorkDays,3,i*10+2); v3c1=v3p2[0]; v3c2=v3p2[1]; v3c3=NO_PREF; comment='研究発表の準備支援希望'; break;
    }

    var submitDate = new Date(2026, 4, 15 + (i % 10), 10 + (i % 7), (i * 11) % 60);
    candRows.push([user.email, s.name, user.name, '2026-06',
      v1c1, v1c2, v1c3, v2c1, v2c2, v2c3, wantThird, v3c1, v3c2, v3c3,
      reducePolicy, comment, submitDate, ictRequest]);
  }

  if (candRows.length > 0) {
    var startRow = candSheet.getLastRow() + 1;
    candSheet.getRange(startRow, 4, candRows.length, 1).setNumberFormat('@');
    candSheet.getRange(startRow, 5, candRows.length, 10).setNumberFormat('@');
    candSheet.getRange(startRow, 1, candRows.length, candidateHeaders.length).setValues(candRows);
  }

  return {
    success: true,
    message: '6月サンプルデータ生成完了: 候補日' + candRows.length + '件。優先スコアは5月の実績が反映されます。'
  };
}
