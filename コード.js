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
var SHEET_MANUAL_SCHEDULE = '手入力スケジュール';

// ===== エントリポイント =====

function doGet(e) {
  var realEmail = Session.getActiveUser().getEmail();
  var params = (e && e.parameter) || {};
  var baseUrl = ScriptApp.getService().getUrl();
  var settings = getSystemSettings_();

  // 教育委員会向け閲覧URL（?role=board&key=...）
  // 役割判定より先に処理。トークン検証は serveBoard_ 内で実施するので、
  // 正しいトークンを持っていればSA以外でも閲覧可能。
  if (params.role === 'board') {
    return serveBoard_(params, baseUrl);
  }

  // ロール自動判定
  var realRole = detectRole_(realEmail);

  // SAのなりすまし機能: SAユーザーがrole・impersonateパラメータで他画面を閲覧
  if (realRole === 'sa' && params.role && params.impersonate) {
    var impEmail = params.impersonate;
    switch (params.role) {
      case 'staff':
        return serveStaff_(impEmail, settings, baseUrl);
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
  template.municipality = schoolInfo ? schoolInfo.municipality : '鹿児島県';
  // 自治体スコープの手入力スケジュール（自校分は詳細、他案件は学校名マスクのため municipality 一致を渡す）
  var myMuni = schoolInfo ? schoolInfo.municipality : '';
  var myMunicipalityManual = [];
  if (myMuni) {
    myMunicipalityManual = getManualSchedules_(null).filter(function(m) { return m.municipality === myMuni; });
  }
  template.myMunicipalityManual = JSON.stringify(myMunicipalityManual);
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
  template.manualSchedules = JSON.stringify(getManualSchedules_(settings.targetMonth));
  template.manualSchools = JSON.stringify(getManualScopedSchools());
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

  // 手入力スケジュールは全件渡し、画面側で自分の分を編集可・他は閲覧のみとする
  var allManual = getManualSchedules_(settings.targetMonth);
  var allManualSchools = getManualScopedSchools();
  // 自分が担当する手入力校
  var myStaffName = staffScheduleInfo.staffName;
  var myManualSchools = allManualSchools.filter(function(s) { return s.staffName === myStaffName; });

  var template = HtmlService.createTemplateFromFile('staff');
  template.email = email;
  template.settings = JSON.stringify(settings);
  template.candidates = JSON.stringify(candidates);
  template.mySchedule = JSON.stringify(staffScheduleInfo.schedule);
  template.myStaffName = myStaffName;
  template.holidays = JSON.stringify(holidays);
  template.meetings = JSON.stringify(meetings);
  template.staffOff = JSON.stringify(staffOff);
  template.manualSchedules = JSON.stringify(allManual);
  template.manualSchools = JSON.stringify(allManualSchools);
  template.myManualSchools = JSON.stringify(myManualSchools);
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
    sheet.appendRow(['お知らせ', '']);
    return { targetMonth: '', deadline: '', status: '', devMode: 'ON', announcement: '' };
  }

  var data = sheet.getDataRange().getValues();
  var settings = { targetMonth: '', deadline: '', status: '', devMode: '', announcement: '' };
  var found = { targetMonth: false, deadline: false, status: false, devMode: false, announcement: false };
  for (var i = 1; i < data.length; i++) {
    var key = String(data[i][0]).trim();
    var val = data[i][1];
    if (key === '対象年月') {
      settings.targetMonth = normalizeTargetMonth_(val);
      found.targetMonth = true;
    }
    if (key === '締切日') {
      if (val instanceof Date) {
        settings.deadline = Utilities.formatDate(val, 'Asia/Tokyo', 'yyyy-MM-dd');
      } else {
        settings.deadline = String(val).trim();
      }
      found.deadline = true;
    }
    if (key === 'ステータス') { settings.status = String(val).trim(); found.status = true; }
    if (key === '開発モード') { settings.devMode = String(val).trim(); found.devMode = true; }
    if (key === 'お知らせ') { settings.announcement = String(val == null ? '' : val); found.announcement = true; }
  }

  // 必要な設定行が未追加の場合、自動追加（既存値はそのまま）
  if (!found.targetMonth)  sheet.appendRow(['対象年月', '']);
  if (!found.deadline)     sheet.appendRow(['締切日', '']);
  if (!found.status)       sheet.appendRow(['ステータス', '']);
  if (!found.devMode)      { sheet.appendRow(['開発モード', 'ON']); settings.devMode = 'ON'; }
  if (!found.announcement) sheet.appendRow(['お知らせ', '']);

  return settings;
}

function updateSystemSettings(newSettings) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_SETTINGS);
  if (!sheet) return { success: false, message: '設定シートが見つかりません。' };

  var data = sheet.getDataRange().getValues();
  var found = { targetMonth: false, deadline: false, status: false, announcement: false };
  for (var i = 1; i < data.length; i++) {
    var key = String(data[i][0]).trim();
    if (key === '対象年月' && newSettings.targetMonth !== undefined) {
      // 月をゼロ埋めしてから保存（"2026-6" → "2026-06"）
      sheet.getRange(i + 1, 2).setNumberFormat('@').setValue(normalizeTargetMonth_(newSettings.targetMonth));
      found.targetMonth = true;
    }
    if (key === '締切日' && newSettings.deadline !== undefined) {
      sheet.getRange(i + 1, 2).setValue(newSettings.deadline);
      found.deadline = true;
    }
    if (key === 'ステータス' && newSettings.status !== undefined) {
      sheet.getRange(i + 1, 2).setValue(newSettings.status);
      found.status = true;
    }
    if (key === 'お知らせ' && newSettings.announcement !== undefined) {
      sheet.getRange(i + 1, 2).setValue(newSettings.announcement);
      found.announcement = true;
    }
  }
  // 行が無ければ追加（保存値が反映されないバグ防止）
  if (newSettings.targetMonth !== undefined && !found.targetMonth) {
    var r = sheet.getLastRow() + 1;
    sheet.appendRow(['対象年月', '']);
    sheet.getRange(r, 2).setNumberFormat('@').setValue(normalizeTargetMonth_(newSettings.targetMonth));
  }
  if (newSettings.deadline !== undefined && !found.deadline) {
    sheet.appendRow(['締切日', newSettings.deadline]);
  }
  if (newSettings.status !== undefined && !found.status) {
    sheet.appendRow(['ステータス', newSettings.status]);
  }
  if (newSettings.announcement !== undefined && !found.announcement) {
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
    '備考', '送信日時', 'ICT支援要望',
    '1回目_第2希望時刻', '1回目_第3希望時刻',
    '2回目_第2希望時刻', '2回目_第3希望時刻'
  ];
  var sheet = getOrCreateSheet_(SHEET_CANDIDATES, headers);
  ensureCandidateExtraColumns_(sheet);

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
    formData.ictRequest || '',
    formData.timeSlot1_2 || '',
    formData.timeSlot1_3 || '',
    formData.timeSlot2_2 || '',
    formData.timeSlot2_3 || ''
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
        timeSlot1_2: String(data[i][18] == null ? '' : data[i][18]),
        timeSlot1_3: String(data[i][19] == null ? '' : data[i][19]),
        timeSlot2_2: String(data[i][20] == null ? '' : data[i][20]),
        timeSlot2_3: String(data[i][21] == null ? '' : data[i][21]),
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
      timeSlot1_2: String(data[i][18] == null ? '' : data[i][18]),
      timeSlot1_3: String(data[i][19] == null ? '' : data[i][19]),
      timeSlot2_2: String(data[i][20] == null ? '' : data[i][20]),
      timeSlot2_3: String(data[i][21] == null ? '' : data[i][21]),
      submittedAt: data[i][16] instanceof Date
        ? Utilities.formatDate(data[i][16], 'Asia/Tokyo', 'yyyy/MM/dd HH:mm')
        : ''
    });
  }
  return results;
}

// 既存の候補日シートに新規希望別時刻列が無ければ追加
function ensureCandidateExtraColumns_(sheet) {
  var lastCol = sheet.getLastColumn();
  var existingHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var have = {};
  for (var i = 0; i < existingHeaders.length; i++) have[String(existingHeaders[i])] = true;
  var toAdd = [];
  if (!have['1回目_第2希望時刻']) toAdd.push('1回目_第2希望時刻');
  if (!have['1回目_第3希望時刻']) toAdd.push('1回目_第3希望時刻');
  if (!have['2回目_第2希望時刻']) toAdd.push('2回目_第2希望時刻');
  if (!have['2回目_第3希望時刻']) toAdd.push('2回目_第3希望時刻');
  if (toAdd.length === 0) return;
  sheet.getRange(1, lastCol + 1, 1, toAdd.length).setValues([toAdd]);
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
        staffEmail: String(data[i][3]).trim(),
        supportCategory: String(data[i][4] || '通常').trim(),
        municipality: String(data[i][5] || '鹿児島県').trim()
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
        supportCategory: String(data[i][4] || '通常').trim(),
        municipality: String(data[i][5] || '鹿児島県').trim()
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
        staffEmail: String(data[i][3]).trim(),
        supportCategory: String(data[i][4] || '通常').trim(),
        municipality: String(data[i][5] || '鹿児島県').trim()
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
      staffEmail: String(data[i][3]).trim(),
      supportCategory: String(data[i][4] || '通常').trim(),
      municipality: String(data[i][5] || '鹿児島県').trim()
    });
  }
  return results;
}

// ===== 初期セットアップ =====

function setupMasterSheets() {
  getOrCreateSheet_(SHEET_SA, ['メールアドレス', '氏名']);
  getOrCreateSheet_(SHEET_STAFF, ['メールアドレス', '氏名', '担当エリア']);
  var schoolSheet = getOrCreateSheet_(SHEET_SCHOOLS, ['学校番号', '学校名', '担当支援員', '支援員メール', '支援区分', '自治体']);
  ensureSchoolMasterExtraColumns_(schoolSheet);
}

// 既存学校マスタに「自治体」列が無ければ追加
function ensureSchoolMasterExtraColumns_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return;
  var hdrs = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var has = false;
  for (var i = 0; i < hdrs.length; i++) if (String(hdrs[i]).trim() === '自治体') { has = true; break; }
  if (has) return;
  sheet.getRange(1, lastCol + 1).setValue('自治体')
    .setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff');
}

function setupSchoolMaster() {
  // R8年度（2026年度）担当校一覧データに基づく学校マスタ。
  // 列: 学校番号 / 学校名 / 担当支援員 / 支援員メール / 支援区分 / 自治体
  //   支援区分: 通常=県立本土 / 離島=県立離島・特別支援(離島) / 市町村=枕崎市 / 手入力=その他自治体
  var allSchools = [
    // ===== 鹿児島県（県立高校・特別支援学校など） =====
    [1001, '鶴丸高校',           '水元 理恵子', 'ict0001@kago.ed.jp', '通常', '鹿児島県'],
    [1002, '甲南高校',           '谷川 麗華',   'ict0007@kago.ed.jp', '通常', '鹿児島県'],
    [1003, '鹿児島中央高校',     '谷川 麗華',   'ict0007@kago.ed.jp', '通常', '鹿児島県'],
    [1004, '錦江湾高校',         '村永 浩',     'ict0003@kago.ed.jp', '通常', '鹿児島県'],
    [1005, '武岡台高校',         '谷川 麗華',   'ict0007@kago.ed.jp', '通常', '鹿児島県'],
    [1006, '開陽高校',           '村永 浩',     'ict0003@kago.ed.jp', '通常', '鹿児島県'],
    [1007, '明桜館高校',         '橋口 大地',   'ict0006@kago.ed.jp', '通常', '鹿児島県'],
    [1008, '松陽高校',           '谷川 麗華',   'ict0007@kago.ed.jp', '通常', '鹿児島県'],
    [1009, '鹿児島東高校',       '水元 理恵子', 'ict0001@kago.ed.jp', '通常', '鹿児島県'],
    [1010, '鹿児島工業高校',     '村永 浩',     'ict0003@kago.ed.jp', '通常', '鹿児島県'],
    [1011, '鹿児島南高校',       '谷川 麗華',   'ict0007@kago.ed.jp', '通常', '鹿児島県'],
    [1012, '指宿高校',           '村永 浩',     'ict0003@kago.ed.jp', '通常', '鹿児島県'],
    [1013, '山川高校',           '村永 浩',     'ict0003@kago.ed.jp', '通常', '鹿児島県'],
    [1014, '頴娃高校',           '村永 浩',     'ict0003@kago.ed.jp', '通常', '鹿児島県'],
    [1015, '枕崎高校',           '村永 浩',     'ict0003@kago.ed.jp', '通常', '鹿児島県'],
    [1016, '鹿児島水産高校',     '村永 浩',     'ict0003@kago.ed.jp', '通常', '鹿児島県'],
    [1017, '加世田高校',         '村永 浩',     'ict0003@kago.ed.jp', '通常', '鹿児島県'],
    [1018, '加世田常潤高校',     '村永 浩',     'ict0003@kago.ed.jp', '通常', '鹿児島県'],
    [1019, '川辺高校',           '村永 浩',     'ict0003@kago.ed.jp', '通常', '鹿児島県'],
    [1020, '薩南工業高校',       '村永 浩',     'ict0003@kago.ed.jp', '通常', '鹿児島県'],
    [1021, '吹上高校',           '村永 浩',     'ict0003@kago.ed.jp', '通常', '鹿児島県'],
    [1022, '伊集院高校',         '拔迫 大地',   'ict0008@kago.ed.jp', '通常', '鹿児島県'],
    [1023, '市来農芸高校',       '拔迫 大地',   'ict0008@kago.ed.jp', '通常', '鹿児島県'],
    [1024, '串木野高校',         '村永 浩',     'ict0003@kago.ed.jp', '通常', '鹿児島県'],
    [1025, '川内高校',           '鈴木 亮',     'ict0004@kago.ed.jp', '通常', '鹿児島県'],
    [1026, '川内商工高校',       '水元 理恵子', 'ict0001@kago.ed.jp', '通常', '鹿児島県'],
    [1027, '川薩清修館高校',     '水元 理恵子', 'ict0001@kago.ed.jp', '通常', '鹿児島県'],
    [1028, '薩摩中央高校',       '鈴木 亮',     'ict0004@kago.ed.jp', '通常', '鹿児島県'],
    [1029, '鶴翔高校',           '鈴木 亮',     'ict0004@kago.ed.jp', '通常', '鹿児島県'],
    [1030, '野田女子高校',       '鈴木 亮',     'ict0004@kago.ed.jp', '通常', '鹿児島県'],
    [1031, '出水高校',           '鈴木 亮',     'ict0004@kago.ed.jp', '通常', '鹿児島県'],
    [1032, '出水工業高校',       '鈴木 亮',     'ict0004@kago.ed.jp', '通常', '鹿児島県'],
    [1033, '大口高校',           '谷口 涼子',   'ict0005@kago.ed.jp', '通常', '鹿児島県'],
    [1034, '伊佐農林高校',       '谷口 涼子',   'ict0005@kago.ed.jp', '通常', '鹿児島県'],
    [1035, '霧島高校',           '水元 理恵子', 'ict0001@kago.ed.jp', '通常', '鹿児島県'],
    [1036, '蒲生高校',           '橋口 大地',   'ict0006@kago.ed.jp', '通常', '鹿児島県'],
    [1037, '加治木高校',         '村永 浩',     'ict0003@kago.ed.jp', '通常', '鹿児島県'],
    [1038, '加治木工業高校',     '村永 浩',     'ict0003@kago.ed.jp', '通常', '鹿児島県'],
    [1039, '隼人工業高校',       '水元 理恵子', 'ict0001@kago.ed.jp', '通常', '鹿児島県'],
    [1040, '国分高校',           '水元 理恵子', 'ict0001@kago.ed.jp', '通常', '鹿児島県'],
    [1041, '福山高校',           '水元 理恵子', 'ict0001@kago.ed.jp', '通常', '鹿児島県'],
    [1042, '曽於高校',           '水元 理恵子', 'ict0001@kago.ed.jp', '通常', '鹿児島県'],
    [1043, '志布志高校',         '水元 理恵子', 'ict0001@kago.ed.jp', '通常', '鹿児島県'],
    [1044, '串良商業高校',       '水元 理恵子', 'ict0001@kago.ed.jp', '通常', '鹿児島県'],
    [1045, '楠隼高校',           '水元 理恵子', 'ict0001@kago.ed.jp', '通常', '鹿児島県'],
    [1046, '楠隼中学校',         '水元 理恵子', 'ict0001@kago.ed.jp', '通常', '鹿児島県'],
    [1047, '鹿屋高校',           '水元 理恵子', 'ict0001@kago.ed.jp', '通常', '鹿児島県'],
    [1048, '鹿屋農業高校',       '水元 理恵子', 'ict0001@kago.ed.jp', '通常', '鹿児島県'],
    [1049, '鹿屋工業高校',       '水元 理恵子', 'ict0001@kago.ed.jp', '通常', '鹿児島県'],
    [1050, '垂水高校',           '水元 理恵子', 'ict0001@kago.ed.jp', '通常', '鹿児島県'],
    [1051, '南大隅高校',         '谷川 麗華',   'ict0007@kago.ed.jp', '通常', '鹿児島県'],
    [1052, '種子島高校',         '鈴木 亮',     'ict0004@kago.ed.jp', '離島', '鹿児島県'],
    [1053, '種子島中央高校',     '鈴木 亮',     'ict0004@kago.ed.jp', '離島', '鹿児島県'],
    [1054, '屋久島高校',         '谷川 麗華',   'ict0007@kago.ed.jp', '離島', '鹿児島県'],
    [1055, '大島高校',           '三池 博孝',   'ict0013@kago.ed.jp', '離島', '鹿児島県'],
    [1056, '奄美高校',           '三池 博孝',   'ict0013@kago.ed.jp', '離島', '鹿児島県'],
    [1057, '大島北高校',         '三池 博孝',   'ict0013@kago.ed.jp', '離島', '鹿児島県'],
    [1058, '古仁屋高校',         '三池 博孝',   'ict0013@kago.ed.jp', '離島', '鹿児島県'],
    [1059, '喜界高校',           '三池 博孝',   'ict0013@kago.ed.jp', '離島', '鹿児島県'],
    [1060, '徳之島高校',         '拔迫 大地',   'ict0008@kago.ed.jp', '離島', '鹿児島県'],
    [1061, '沖永良部高校',       '拔迫 大地',   'ict0008@kago.ed.jp', '離島', '鹿児島県'],
    [1062, '与論高校',           '中根 秀幸',   'ict0009@kago.ed.jp', '離島', '鹿児島県'],
    [1063, '大島特別支援',       '三池 博孝',   'ict0013@kago.ed.jp', '離島', '鹿児島県'],
    [1064, '出水特別支援',       '鈴木 亮',     'ict0004@kago.ed.jp', '通常', '鹿児島県'],
    [1065, '中種子特別支援',     '鈴木 亮',     'ict0004@kago.ed.jp', '離島', '鹿児島県'],
    [1066, '牧之原特別支援',     '水元 理恵子', 'ict0001@kago.ed.jp', '通常', '鹿児島県'],
    [1067, '鹿屋特別支援',       '水元 理恵子', 'ict0001@kago.ed.jp', '通常', '鹿児島県'],
    [1068, '盲学校',             '村永 浩',     'ict0003@kago.ed.jp', '通常', '鹿児島県'],
    [1069, '聾学校',             '村永 浩',     'ict0003@kago.ed.jp', '通常', '鹿児島県'],
    [1070, '鹿児島南特別支援',   '村永 浩',     'ict0003@kago.ed.jp', '通常', '鹿児島県'],
    [1071, '指宿特別支援',       '村永 浩',     'ict0003@kago.ed.jp', '通常', '鹿児島県'],
    [1072, '南薩特別支援',       '村永 浩',     'ict0003@kago.ed.jp', '通常', '鹿児島県'],
    [1073, '串木野特別支援',     '村永 浩',     'ict0003@kago.ed.jp', '通常', '鹿児島県'],
    [1074, '加治木特別支援',     '村永 浩',     'ict0003@kago.ed.jp', '通常', '鹿児島県'],
    [1075, 'いろは中学校',       '谷川 麗華',   'ict0007@kago.ed.jp', '通常', '鹿児島県'],
    [1076, '武岡台特別支援',     '谷川 麗華',   'ict0007@kago.ed.jp', '通常', '鹿児島県'],
    [1077, '鹿児島特別支援',     '谷川 麗華',   'ict0007@kago.ed.jp', '通常', '鹿児島県'],
    [1078, '鹿児島高等特別支援', '谷川 麗華',   'ict0007@kago.ed.jp', '通常', '鹿児島県'],

    // ===== 枕崎市（市町村案件） =====
    [2001, '枕崎小',             '村永 浩',     'ict0003@kago.ed.jp', '市町村', '枕崎市'],
    [2002, '桜山小',             '村永 浩',     'ict0003@kago.ed.jp', '市町村', '枕崎市'],
    [2003, '立神小',             '村永 浩',     'ict0003@kago.ed.jp', '市町村', '枕崎市'],
    [2004, '別府小(枕崎市)',     '村永 浩',     'ict0003@kago.ed.jp', '市町村', '枕崎市'],
    [2005, '枕崎中',             '村永 浩',     'ict0003@kago.ed.jp', '市町村', '枕崎市'],
    [2006, '桜山中',             '村永 浩',     'ict0003@kago.ed.jp', '市町村', '枕崎市'],
    [2007, '立神中',             '村永 浩',     'ict0003@kago.ed.jp', '市町村', '枕崎市'],
    [2008, '別府中',             '村永 浩',     'ict0003@kago.ed.jp', '市町村', '枕崎市'],

    // ===== 肝付町（手入力） =====
    [3001, '高山中',             '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '肝付町'],
    [3002, '国見小',             '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '肝付町'],
    [3003, '国見中',             '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '肝付町'],
    [3004, '内之浦小',           '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '肝付町'],
    [3005, '波野中',             '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '肝付町'],
    [3006, '岸良学園',           '拔迫 大地',   'ict0008@kago.ed.jp', '手入力', '肝付町'],
    [3007, '宮富小',             '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '肝付町'],
    [3008, '高山小',             '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '肝付町'],
    [3009, '内之浦中',           '拔迫 大地',   'ict0008@kago.ed.jp', '手入力', '肝付町'],
    [3010, '波野小',             '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '肝付町'],

    // ===== 霧島市（手入力） =====
    [3011, '国分中(グループ)',   '拔迫 大地',   'ict0008@kago.ed.jp', '手入力', '霧島市'],
    [3012, '日当山中(グループ)', '谷口 涼子',   'ict0005@kago.ed.jp', '手入力', '霧島市'],
    [3013, '舞鶴中(グループ)',   '拔迫 大地',   'ict0008@kago.ed.jp', '手入力', '霧島市'],
    [3014, '霧島中(グループ)',   '谷口 涼子',   'ict0005@kago.ed.jp', '手入力', '霧島市'],
    [3015, '国分南中(グループ)', '拔迫 大地',   'ict0008@kago.ed.jp', '手入力', '霧島市'],
    [3016, '天降川小(グループ)', '拔迫 大地',   'ict0008@kago.ed.jp', '手入力', '霧島市'],
    [3017, '牧園中(グループ)',   '谷口 涼子',   'ict0005@kago.ed.jp', '手入力', '霧島市'],
    [3018, '隼人中(グループ)',   '拔迫 大地',   'ict0008@kago.ed.jp', '手入力', '霧島市'],
    [3019, '陵南中(グループ)',   '谷口 涼子',   'ict0005@kago.ed.jp', '手入力', '霧島市'],
    [3020, '横川中(グループ)',   '谷口 涼子',   'ict0005@kago.ed.jp', '手入力', '霧島市'],

    // ===== 球磨村（手入力） =====
    [3021, '球磨中',             '谷口 涼子',   'ict0005@kago.ed.jp', '手入力', '球磨村'],
    [3022, '一勝地小',           '谷口 涼子',   'ict0005@kago.ed.jp', '手入力', '球磨村'],
    [3023, '渡小',               '谷口 涼子',   'ict0005@kago.ed.jp', '手入力', '球磨村'],

    // ===== 薩摩川内市（手入力。遠矢担当3校は一旦 橋口 大地 に振替） =====
    [3024, '薩摩川内市教委',     '橋口 大地',   'ict0006@kago.ed.jp', '手入力', '薩摩川内市'],
    [3025, '里小',               '拔迫 大地',   'ict0008@kago.ed.jp', '手入力', '薩摩川内市'],
    [3026, '中津小',             '拔迫 大地',   'ict0008@kago.ed.jp', '手入力', '薩摩川内市'],
    [3027, '里中',               '拔迫 大地',   'ict0008@kago.ed.jp', '手入力', '薩摩川内市'],
    [3028, '育英小',             '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '薩摩川内市'],
    [3029, '川内北中',           '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '薩摩川内市'],
    [3030, '平成中',             '橋口 大地',   'ict0006@kago.ed.jp', '手入力', '薩摩川内市'], // 遠矢→橋口
    [3031, '樋脇中',             '橋口 大地',   'ict0006@kago.ed.jp', '手入力', '薩摩川内市'], // 遠矢→橋口
    [3032, '川内小',             '橋口 大地',   'ict0006@kago.ed.jp', '手入力', '薩摩川内市'], // 遠矢→橋口
    [3033, '可愛小',             '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '薩摩川内市'],
    [3034, '峰山小',             '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '薩摩川内市'],
    [3035, '東郷学園小',         '鈴木 亮',     'ict0004@kago.ed.jp', '手入力', '薩摩川内市'],
    [3036, '東郷学園中',         '鈴木 亮',     'ict0004@kago.ed.jp', '手入力', '薩摩川内市'],
    [3037, '水引中',             '鈴木 亮',     'ict0004@kago.ed.jp', '手入力', '薩摩川内市'],
    [3038, '平佐東小',           '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '薩摩川内市'],
    [3039, '入来中',             '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '薩摩川内市'],
    [3040, '水引小',             '鈴木 亮',     'ict0004@kago.ed.jp', '手入力', '薩摩川内市'],
    [3041, '城上小',             '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '薩摩川内市'],
    [3042, '八幡小',             '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '薩摩川内市'],
    [3043, '高来小',             '橋口 大地',   'ict0006@kago.ed.jp', '手入力', '薩摩川内市'],
    [3044, '樋脇小',             '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '薩摩川内市'],
    [3045, '市比野小',           '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '薩摩川内市'],
    [3046, '永利小',             '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '薩摩川内市'],
    [3047, '川内中央中',         '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '薩摩川内市'],
    [3048, '川内南中',           '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '薩摩川内市'],
    [3049, '祁答院中',           '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '薩摩川内市'],
    [3050, '亀山小',             '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '薩摩川内市'],
    [3051, '隈之城小',           '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '薩摩川内市'],
    [3052, '平佐西小',           '橋口 大地',   'ict0006@kago.ed.jp', '手入力', '薩摩川内市'],
    [3053, '入来小',             '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '薩摩川内市'],
    [3054, '副田小',             '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '薩摩川内市'],
    [3055, '祁答院小',           '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '薩摩川内市'],
    [3056, '手打小',             '鈴木 亮',     'ict0004@kago.ed.jp', '手入力', '薩摩川内市'],
    [3057, '長浜小',             '鈴木 亮',     'ict0004@kago.ed.jp', '手入力', '薩摩川内市'],
    [3058, '鹿島小',             '鈴木 亮',     'ict0004@kago.ed.jp', '手入力', '薩摩川内市'],
    [3059, '海星中',             '鈴木 亮',     'ict0004@kago.ed.jp', '手入力', '薩摩川内市'],

    // ===== 水上村（手入力） =====
    [3060, '水上学園',           '谷口 涼子',   'ict0005@kago.ed.jp', '手入力', '水上村'],

    // ===== あさぎり町（手入力） =====
    [3061, '上小学校',           '谷口 涼子',   'ict0005@kago.ed.jp', '手入力', 'あさぎり町'],
    [3062, '免田小',             '谷口 涼子',   'ict0005@kago.ed.jp', '手入力', 'あさぎり町'],
    [3063, '岡原小',             '中根 秀幸',   'ict0009@kago.ed.jp', '手入力', 'あさぎり町'],
    [3064, '須恵小',             '谷口 涼子',   'ict0005@kago.ed.jp', '手入力', 'あさぎり町'],
    [3065, '深田小',             '谷口 涼子',   'ict0005@kago.ed.jp', '手入力', 'あさぎり町'],
    [3066, 'あさぎり中',         '谷口 涼子',   'ict0005@kago.ed.jp', '手入力', 'あさぎり町'],

    // ===== 大崎町（手入力） =====
    [3067, '大崎小',             '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '大崎町'],
    [3068, '菱田小',             '谷川 麗華',   'ict0007@kago.ed.jp', '手入力', '大崎町'],
    [3069, '中沖小',             '谷川 麗華',   'ict0007@kago.ed.jp', '手入力', '大崎町'],
    [3070, '持留小',             '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '大崎町'],
    [3071, '大丸小(大崎町)',     '谷川 麗華',   'ict0007@kago.ed.jp', '手入力', '大崎町'],
    [3072, '野方小',             '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '大崎町'],
    [3073, '大崎中',             '水元 理恵子', 'ict0001@kago.ed.jp', '手入力', '大崎町'],

    // ===== 長島町（手入力） =====
    [3074, '平尾小',             '中根 秀幸',   'ict0009@kago.ed.jp', '手入力', '長島町'],
    [3075, '獅子島中',           '中根 秀幸',   'ict0009@kago.ed.jp', '手入力', '長島町'],
    [3076, '獅子島小',           '中根 秀幸',   'ict0009@kago.ed.jp', '手入力', '長島町'],
    [3077, '蔵之元小',           '鈴木 亮',     'ict0004@kago.ed.jp', '手入力', '長島町'],
    [3078, '長島中',             '中根 秀幸',   'ict0009@kago.ed.jp', '手入力', '長島町'],
    [3079, '城川内小',           '鈴木 亮',     'ict0004@kago.ed.jp', '手入力', '長島町'],
    [3080, '川床中',             '中根 秀幸',   'ict0009@kago.ed.jp', '手入力', '長島町'],
    [3081, '川床小',             '中根 秀幸',   'ict0009@kago.ed.jp', '手入力', '長島町'],
    [3082, '平尾中',             '中根 秀幸',   'ict0009@kago.ed.jp', '手入力', '長島町'],
    [3083, '鷹巣中',             '中根 秀幸',   'ict0009@kago.ed.jp', '手入力', '長島町'],
    [3084, '鷹巣小',             '中根 秀幸',   'ict0009@kago.ed.jp', '手入力', '長島町'],
    [3085, '伊唐小',             '中根 秀幸',   'ict0009@kago.ed.jp', '手入力', '長島町'],

    // ===== 南九州市（手入力。全校 村永 浩 担当） =====
    [3086, '頴娃小',             '村永 浩',     'ict0003@kago.ed.jp', '手入力', '南九州市'],
    [3087, '宮脇小',             '村永 浩',     'ict0003@kago.ed.jp', '手入力', '南九州市'],
    [3088, '九玉小',             '村永 浩',     'ict0003@kago.ed.jp', '手入力', '南九州市'],
    [3089, '別府小(南九州市)',   '村永 浩',     'ict0003@kago.ed.jp', '手入力', '南九州市'],
    [3090, '青戸小',             '村永 浩',     'ict0003@kago.ed.jp', '手入力', '南九州市'],
    [3091, '粟ヶ窪小',           '村永 浩',     'ict0003@kago.ed.jp', '手入力', '南九州市'],
    [3092, '知覧小',             '村永 浩',     'ict0003@kago.ed.jp', '手入力', '南九州市'],
    [3093, '霜出小',             '村永 浩',     'ict0003@kago.ed.jp', '手入力', '南九州市'],
    [3094, '松ヶ浦小',           '村永 浩',     'ict0003@kago.ed.jp', '手入力', '南九州市'],
    [3095, '中福良小',           '村永 浩',     'ict0003@kago.ed.jp', '手入力', '南九州市'],
    [3096, '松山小',             '村永 浩',     'ict0003@kago.ed.jp', '手入力', '南九州市'],
    [3097, '川辺小',             '村永 浩',     'ict0003@kago.ed.jp', '手入力', '南九州市'],
    [3098, '高田小',             '村永 浩',     'ict0003@kago.ed.jp', '手入力', '南九州市'],
    [3099, '清水小',             '村永 浩',     'ict0003@kago.ed.jp', '手入力', '南九州市'],
    [3100, '勝目小',             '村永 浩',     'ict0003@kago.ed.jp', '手入力', '南九州市'],
    [3101, '大丸小(南九州市)',   '村永 浩',     'ict0003@kago.ed.jp', '手入力', '南九州市'],
    [3102, '頴娃中',             '村永 浩',     'ict0003@kago.ed.jp', '手入力', '南九州市'],
    [3103, '知覧中',             '村永 浩',     'ict0003@kago.ed.jp', '手入力', '南九州市'],
    [3104, '川辺中',             '村永 浩',     'ict0003@kago.ed.jp', '手入力', '南九州市'],

    // ===== 東串良町（手入力） =====
    [3105, '東串良中',           '谷川 麗華',   'ict0007@kago.ed.jp', '手入力', '東串良町'],
    [3106, '柏原小',             '谷川 麗華',   'ict0007@kago.ed.jp', '手入力', '東串良町'],
    [3107, '池之原小',           '谷川 麗華',   'ict0007@kago.ed.jp', '手入力', '東串良町'],

    // ===== 湧水町（手入力） =====
    [3108, '上場小',             '谷口 涼子',   'ict0005@kago.ed.jp', '手入力', '湧水町'],
    [3109, '栗野小',             '中根 秀幸',   'ict0009@kago.ed.jp', '手入力', '湧水町'],
    [3110, '栗野中',             '谷口 涼子',   'ict0005@kago.ed.jp', '手入力', '湧水町'],
    [3111, '幸田小',             '谷口 涼子',   'ict0005@kago.ed.jp', '手入力', '湧水町'],
    [3112, '轟小',               '谷口 涼子',   'ict0005@kago.ed.jp', '手入力', '湧水町'],
    [3113, '吉松中',             '中根 秀幸',   'ict0009@kago.ed.jp', '手入力', '湧水町'],
    [3114, '吉松小',             '中根 秀幸',   'ict0009@kago.ed.jp', '手入力', '湧水町']
  ];

  var sheet = getOrCreateSheet_(SHEET_SCHOOLS, ['学校番号', '学校名', '担当支援員', '支援員メール', '支援区分', '自治体']);
  ensureSchoolMasterExtraColumns_(sheet);

  // 既存データがあればクリア（ヘッダー行は残す）
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  }

  // データ投入（6列）
  if (allSchools.length > 0) {
    sheet.getRange(2, 1, allSchools.length, 6).setValues(allSchools);
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
    ['ict0008@kago.ed.jp', '拔迫 大地', '日置・離島エリア'],
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
    ['ict0008@kago.ed.jp', '拔迫 大地'],
    ['ict0009@kago.ed.jp', '中根 秀幸']
  ];
  saSheet.getRange(2, 1, saList.length, 2).setValues(saList);

  return { success: true, message: '学校マスタ ' + allSchools.length + '校、支援員マスタ ' + staffMembers.length + '名、SAマスタ ' + saList.length + '名を登録しました。' };
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
    ['ict0008@kago.ed.jp', '拔迫 大地'],
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

// ===== 鹿児島サンプルデータ 共通定数・ヘルパー =====

var KAGO_TEACHER_NAMES_ = [
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
var KAGO_TEACHER_ROLES_ = ['教頭', 'ICT担当', '情報教育担当', '研究主任'];

var KAGO_STAFF_LIST_ = [
  { name: '三池 博孝',     email: 'ict0013@kago.ed.jp' },
  { name: '鈴木 亮',       email: 'ict0004@kago.ed.jp' },
  { name: '谷口 涼子',     email: 'ict0005@kago.ed.jp' },
  { name: '橋口 大地',     email: 'ict0006@kago.ed.jp' },
  { name: '水元 理恵子',   email: 'ict0001@kago.ed.jp' },
  { name: '村永 浩',       email: 'ict0003@kago.ed.jp' },
  { name: '谷川 麗華',     email: 'ict0007@kago.ed.jp' },
  { name: '中根 秀幸',     email: 'ict0009@kago.ed.jp' },
  { name: '拔迫 大地',     email: 'ict0008@kago.ed.jp' }
];
var KAGO_STAFF_OFF_REASONS_ = ['通院', '私用', '研修', '校内研修', '子の学校行事', '出張', '講習会'];

// 月→定例会日付・名称（金曜日に固定）
var KAGO_MEETINGS_ = {
  5: { date: '2026-05-15', name: '5月定例会' },
  6: { date: '2026-06-19', name: '6月定例会' },
  7: { date: '2026-07-17', name: '7月定例会' }
};

// 学校マスタを読み込んで利用しやすい配列で返す
function loadKagoSchools_() {
  var schoolSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SCHOOLS);
  if (!schoolSheet) return null;
  var data = schoolSheet.getDataRange().getValues();
  var schools = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0] || !data[i][1]) continue;
    var category = String(data[i][4] || '通常').trim();
    schools.push({
      code: String(data[i][0]).trim(),
      name: String(data[i][1]).trim(),
      category: category,
      municipality: String(data[i][5] || '鹿児島県').trim(),
      isIsland: category === '離島',
      isMakurazaki: category === '市町村',
      isManual: category === '手入力'
    });
  }
  return schools;
}

// 教員アカウントが無ければ追加（戻り値: 新規追加件数）
// allSchools の各要素に teacherEmail / teacherName / teacherRole を付与
function ensureSampleTeacherAccounts_(allSchools) {
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
    var nameInfo = KAGO_TEACHER_NAMES_[i % KAGO_TEACHER_NAMES_.length];
    var email;
    if (school.isMakurazaki) {
      email = 't' + school.code + nameInfo.rsn.charAt(0) + '@kago.ed.jp';
    } else {
      email = 's-' + nameInfo.rsn + school.code + '@kago.ed.jp';
    }
    school.teacherEmail = email;
    school.teacherName = nameInfo.sn + ' ' + nameInfo.fn;
    school.teacherRole = KAGO_TEACHER_ROLES_[i % KAGO_TEACHER_ROLES_.length];

    if (!existingEmails[email]) {
      var regDate = new Date(2026, 3, 10 + (i % 15));
      newUsers.push([email, school.name, school.teacherName, school.teacherRole, regDate]);
    }
  }
  if (newUsers.length > 0) {
    userSheet.getRange(userSheet.getLastRow() + 1, 1, newUsers.length, 5).setValues(newUsers);
  }
  return newUsers.length;
}

// 月次の支援員休日サンプルを投入（重複は自動スキップ、戻り値: 追加件数）
function setupKagoMonthlyStaffOff_(year, month) {
  var staffOffSheet = getOrCreateSheet_(SHEET_STAFF_OFF, STAFF_OFF_HEADERS);
  ensureStaffOffStatusColumns_(staffOffSheet);

  var weekdays = getWeekdaysInMonth_(year, month);
  if (weekdays.length === 0) return 0;

  // 既存の (日付, 支援員名) を収集
  var existingKeys = {};
  if (staffOffSheet.getLastRow() > 1) {
    var ed = staffOffSheet.getRange(2, 1, staffOffSheet.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < ed.length; i++) {
      var d = ed[i][0];
      var n = String(ed[i][1]).trim();
      var dStr = d instanceof Date ? Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd') : String(d).trim();
      existingKeys[dStr + '|' + n] = true;
    }
  }

  var added = 0;
  for (var i = 0; i < KAGO_STAFF_LIST_.length; i++) {
    var dayIdx = ((i * 3) + (month - 1) * 2 + 1) % weekdays.length;
    var date = weekdays[dayIdx];
    var staff = KAGO_STAFF_LIST_[i];
    if (existingKeys[date + '|' + staff.name]) continue;

    var reason = KAGO_STAFF_OFF_REASONS_[(i + month) % KAGO_STAFF_OFF_REASONS_.length];
    var status, rejectReason = '';
    var modIdx = (i + month) % 9;
    if (modIdx === 7) {
      status = '申請中';
    } else if (modIdx === 8) {
      status = '却下';
      rejectReason = '同日に他の支援員も希望しているため再調整をお願いします';
    } else {
      status = '承認済';
    }

    var requestedAt = new Date(year, month - 2, 15 + i, 10, i * 5);
    staffOffSheet.appendRow([date, staff.name, reason, status, rejectReason, staff.email, requestedAt]);
    added++;
  }
  return added;
}

// 月次の定例会を投入（重複は自動スキップ、戻り値: 追加されたか）
function setupKagoMonthlyMeeting_(year, month) {
  var info = KAGO_MEETINGS_[month];
  if (!info) return false;

  var meetingSheet = getOrCreateSheet_(SHEET_MEETINGS, ['日付', '名称']);
  var data = meetingSheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var d = data[i][0];
    var dStr = d instanceof Date ? Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd') : String(d).trim();
    if (dStr === info.date) return false;
  }
  meetingSheet.appendRow([info.date, info.name]);
  return true;
}

// 候補日シートに行を追記（フォーマット適用込み）
function appendCandidateRows_(rows) {
  if (!rows || rows.length === 0) return;
  var candHeaders = [
    'メールアドレス', '学校名', '氏名', '対象年月',
    '支援種別', '時間帯',
    '1回目_第1候補', '1回目_第2候補', '1回目_第3候補',
    '2回目希望', '2回目_支援種別', '2回目_時間帯',
    '2回目_第1候補', '2回目_第2候補', '2回目_第3候補',
    '備考', '送信日時', 'ICT支援要望',
    '1回目_第2希望時刻', '1回目_第3希望時刻',
    '2回目_第2希望時刻', '2回目_第3希望時刻'
  ];
  var candSheet = getOrCreateSheet_(SHEET_CANDIDATES, candHeaders);
  ensureCandidateExtraColumns_(candSheet);
  var startRow = candSheet.getLastRow() + 1;
  var fullRange = candSheet.getRange(startRow, 1, rows.length, candHeaders.length);
  fullRange.setNumberFormat('@');
  SpreadsheetApp.flush();
  fullRange.setValues(rows);
  candSheet.getRange(startRow, 17, rows.length, 1).setNumberFormat('yyyy/mm/dd hh:mm');
}

// ===== 6月・7月サンプルデータ生成 =====

// メイン関数: 6月+7月のサンプルデータをまとめて投入（既存データは保持、追記モード）
function setupSampleDataJunJul2026() {
  // 1. 学校マスタ読み込み
  var allSchools = loadKagoSchools_();
  if (!allSchools) return { success: false, message: '学校マスタが見つかりません' };

  // 2. 教員アカウント生成
  var newUsersCount = ensureSampleTeacherAccounts_(allSchools);

  // 3. 候補日生成（6月+7月、2か月合計分布で振り分け）
  var weekdaysJun = getWeekdaysInMonth_(2026, 6);
  var weekdaysJul = getWeekdaysInMonth_(2026, 7);

  var allRows = [];
  for (var i = 0; i < allSchools.length; i++) {
    var school = allSchools[i];
    // 手入力カテゴリの学校は候補日を生成しない（SA/支援員が直接スケジュール作成）
    if (school.isManual) continue;
    var rand = seededRand_(parseInt(school.code) * 31 + 17);

    var junePlan, julyPlan;
    if (school.isMakurazaki) {
      junePlan = { v: 1, o: 0 };
      julyPlan = { v: 1, o: 0 };
    } else {
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
  appendCandidateRows_(allRows);

  // 4. 支援員休日 + 定例会
  var so6 = setupKagoMonthlyStaffOff_(2026, 6);
  var so7 = setupKagoMonthlyStaffOff_(2026, 7);
  var m6  = setupKagoMonthlyMeeting_(2026, 6);
  var m7  = setupKagoMonthlyMeeting_(2026, 7);

  var juneCount = 0, julyCount = 0;
  for (var i = 0; i < allRows.length; i++) {
    if (allRows[i][3] === '2026-06') juneCount++;
    else if (allRows[i][3] === '2026-07') julyCount++;
  }

  return {
    success: true,
    message: '6月・7月サンプルデータ生成完了: 教員追加' + newUsersCount + '名 / 候補日 6月' + juneCount +
      '件・7月' + julyCount + '件 / 支援員休日 6月' + so6 + '件・7月' + so7 + '件' +
      (m6 ? ' / 6月定例会追加' : '') + (m7 ? ' / 7月定例会追加' : '')
  };
}

// 1校1月分の候補日レコードを構築
function buildCandidateRow_(school, targetMonth, plan, weekdays, rand, submitIdx) {
  if (plan.v + plan.o === 0) return null;

  var supportType = '', timeSlot = '', v1c1 = '', v1c2 = '', v1c3 = '';
  var wantSecond = false, supportType2 = '', timeSlot2 = '';
  var v2c1 = '', v2c2 = '', v2c3 = '';
  // 新規: オンライン要望の希望別第2/第3時刻
  var ts1_2 = '', ts1_3 = '', ts2_2 = '', ts2_3 = '';
  var comment = '';

  // 1回目: 訪問優先
  if (plan.v >= 1) {
    supportType = '訪問';
    timeSlot = school.isIsland ? '09:00-16:00' : (rand() < 0.5 ? '09:00-12:00' : '13:30-16:30');
  } else {
    supportType = 'オンライン';
    timeSlot = pickOnlineTime_(rand);
    ts1_2 = pickOnlineTime_(rand);
    ts1_3 = pickOnlineTime_(rand);
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
    ts2_2 = pickOnlineTime_(rand);
    ts2_3 = pickOnlineTime_(rand);
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
    comment, submitDate, ictRequest,
    ts1_2, ts1_3, ts2_2, ts2_3
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

// ===== 5月サンプルデータ生成（鹿児島用） =====

function setupSampleDataMay2026() {
  // 1. システム設定を5月に
  var settingsSheet = getOrCreateSheet_(SHEET_SETTINGS, ['設定名', '値']);
  var settingsData = settingsSheet.getDataRange().getValues();
  for (var i = 1; i < settingsData.length; i++) {
    var key = String(settingsData[i][0]).trim();
    if (key === '対象年月')   settingsSheet.getRange(i + 1, 2).setNumberFormat('@').setValue('2026-05');
    if (key === '締切日')     settingsSheet.getRange(i + 1, 2).setValue('2026-04-25');
    if (key === 'ステータス') settingsSheet.getRange(i + 1, 2).setValue('締切');
  }

  // 2. 学校マスタ読み込み
  var allSchools = loadKagoSchools_();
  if (!allSchools) return { success: false, message: '学校マスタが見つかりません。先に setupSchoolMaster を実行してください。' };

  // 3. 教員アカウント生成（既存はスキップ）
  var newUsersCount = ensureSampleTeacherAccounts_(allSchools);

  // 4. 5月分の候補日生成（5月単月の分布。離島=終日固定、本土・市町村=AM/PM、オンラインも含む）
  var weekdays = getWeekdaysInMonth_(2026, 5);
  var rows = [];
  for (var i = 0; i < allSchools.length; i++) {
    var school = allSchools[i];
    // 手入力カテゴリの学校は候補日を生成しない
    if (school.isManual) continue;
    var rand = seededRand_(parseInt(school.code) * 41 + 5);

    var plan;
    if (school.isMakurazaki) {
      plan = { v: 1, o: 0 };
    } else {
      // 5月単月分布: 訪問は0/1/2/3を 50/40/8/2、オンラインは0/1/2を 78/20/2
      var v = pickWeighted_([
        { v: 0, w: 50 }, { v: 1, w: 40 }, { v: 2, w: 8 }, { v: 3, w: 2 }
      ], rand());
      var o = pickWeighted_([
        { v: 0, w: 78 }, { v: 1, w: 20 }, { v: 2, w: 2 }
      ], rand());
      plan = { v: v, o: o };
    }

    var row = buildCandidateRow_(school, '2026-05', plan, weekdays, rand, i);
    if (row) rows.push(row);
  }
  appendCandidateRows_(rows);

  // 5. 支援員休日 + 定例会
  var staffOffAdded = setupKagoMonthlyStaffOff_(2026, 5);
  var meetingAdded  = setupKagoMonthlyMeeting_(2026, 5);

  return {
    success: true,
    message: '5月サンプルデータ生成完了: 教員追加' + newUsersCount + '名 / 候補日' + rows.length +
      '件 / 支援員休日' + staffOffAdded + '件' + (meetingAdded ? ' / 5月定例会追加' : '')
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
    var month = normalizeTargetMonth_(data[i][0]);
    if (targetMonth && month !== targetMonth) continue;
    results.push({
      targetMonth: month,
      date: normalizeCandidateDate_(data[i][1]),
      staffName: String(data[i][2]).trim(),
      schoolName: String(data[i][3]).trim(),
      candidateRank: String(data[i][4]).trim(),
      status: String(data[i][5]).trim(),
      origStaff: String(data[i][6] || '').trim(),
      timeSlot: String(data[i][7] == null ? '' : data[i][7]).trim(),
      supportType: String(data[i][8] == null ? '' : data[i][8]).trim()
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

// 'HH:MM-HH:MM' 形式の時刻範囲を分単位に分解
function parseTimeRange_(timeSlot) {
  var parts = String(timeSlot || '').split('-');
  if (parts.length !== 2) return null;
  var s = parts[0].split(':');
  var e = parts[1].split(':');
  if (s.length !== 2 || e.length !== 2) return null;
  var sm = parseInt(s[0], 10) * 60 + parseInt(s[1], 10);
  var em = parseInt(e[0], 10) * 60 + parseInt(e[1], 10);
  if (isNaN(sm) || isNaN(em)) return null;
  return { start: sm, end: em };
}

// 支援種別+時間帯から、排他制御に使う slotInfo を得る
function getSlotInfo_(supportType, timeSlot) {
  if (supportType === 'オンライン') {
    var r = parseTimeRange_(timeSlot);
    return { type: 'ONLINE', startMin: r ? r.start : 0, endMin: r ? r.end : 0, timeSlot: timeSlot };
  }
  if (timeSlot === '09:00-12:00') return { type: 'AM' };
  if (timeSlot === '13:30-16:30') return { type: 'PM' };
  if (timeSlot === '09:00-16:00') return { type: 'FULL' };
  return { type: 'AM' };
}

// 後方互換: 旧 getSlotKey_ 呼び出し用（type のみを返す）
function getSlotKey_(supportType, timeSlot) {
  return getSlotInfo_(supportType, timeSlot).type;
}

// (date, slotInfo) が利用可能か
//  AM+PM 同日OK / FULL は他をブロック / ONLINE は時刻が重ならなければ同日複数OK
function canUseSlot_(usedSlots, date, slotInfo) {
  if (!usedSlots[date]) return true;
  var u = usedSlots[date];
  if (slotInfo.type === 'FULL') return !(u.AM || u.PM || u.FULL || (u.online && u.online.length > 0));
  if (slotInfo.type === 'AM')   return !(u.AM || u.FULL);
  if (slotInfo.type === 'PM')   return !(u.PM || u.FULL);
  if (slotInfo.type === 'ONLINE') {
    if (u.FULL) return false;
    var ranges = u.online || [];
    for (var i = 0; i < ranges.length; i++) {
      // [s,e) ベースで重なり判定
      if (slotInfo.startMin < ranges[i].end && slotInfo.endMin > ranges[i].start) return false;
    }
    return true;
  }
  return true;
}

function markSlotUsed_(usedSlots, date, slotInfo) {
  if (!usedSlots[date]) usedSlots[date] = {};
  var u = usedSlots[date];
  if (slotInfo.type === 'AM' || slotInfo.type === 'PM' || slotInfo.type === 'FULL') {
    u[slotInfo.type] = true;
  } else if (slotInfo.type === 'ONLINE') {
    if (!u.online) u.online = [];
    u.online.push({ start: slotInfo.startMin, end: slotInfo.endMin });
  }
}

// スケジュールシートに「時間帯」「支援種別」列が無ければ追加
function ensureScheduleExtraColumns_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return;
  var hdrs = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var have = {};
  for (var i = 0; i < hdrs.length; i++) have[String(hdrs[i]).trim()] = true;

  var toAdd = [];
  if (!have['時間帯']) toAdd.push('時間帯');
  if (!have['支援種別']) toAdd.push('支援種別');

  for (var i = 0; i < toAdd.length; i++) {
    var col = sheet.getLastColumn() + 1;
    sheet.getRange(1, col).setValue(toAdd[i])
      .setFontWeight('bold').setBackground('#1a73e8').setFontColor('#ffffff');
  }
}

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

  // --- 4. 候補日を Visit 単位のリクエストに分解（オンライン要望は SA 担当に振り分け） ---
  var ONLINE_SA_STAFF = '山崎 混平'; // オンライン支援を一括担当するSA

  // (rawDates, rawSlots, supportType) から候補ペアの配列を構築
  function buildCandidatePairs_(rawDates, rawSlots, supportType) {
    var pairs = [];
    for (var i = 0; i < rawDates.length; i++) {
      var d = rawDates[i];
      if (!d || d === '特に指定しない' || d === 'undefined') continue;
      var ts = rawSlots[i] || '';
      pairs.push({
        date: d,
        timeSlot: ts,
        slotInfo: getSlotInfo_(supportType, ts)
      });
    }
    return pairs;
  }

  var allRequests = [];
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    var schoolStaff = schoolStaffMap[c.schoolName];
    if (!schoolStaff) continue;

    // 1回目: 時刻は訪問なら全候補共通、オンラインなら候補ごと
    var stype1 = c.supportType || '訪問';
    var v1Slots = (stype1 === 'オンライン')
      ? [c.timeSlot || '', c.timeSlot1_2 || c.timeSlot || '', c.timeSlot1_3 || c.timeSlot || '']
      : [c.timeSlot || '', c.timeSlot || '', c.timeSlot || ''];
    var v1Pairs = buildCandidatePairs_([c.v1c1, c.v1c2, c.v1c3], v1Slots, stype1);
    var v1Staff = (stype1 === 'オンライン') ? ONLINE_SA_STAFF : schoolStaff;
    allRequests.push({
      schoolName: c.schoolName,
      visitNum: 1,
      pairs: v1Pairs,
      supportType: stype1,
      // フォールバック検索用（第1希望の slotInfo / timeSlot を使用）
      fallbackSlotInfo: getSlotInfo_(stype1, v1Slots[0]),
      fallbackTimeSlot: v1Slots[0],
      staff: v1Staff,
      priority: priorityScores[c.schoolName] || 0
    });

    // 2回目（希望校のみ）
    if (c.wantSecond) {
      var stype2 = c.supportType2 || '訪問';
      var v2Slots = (stype2 === 'オンライン')
        ? [c.timeSlot2 || '', c.timeSlot2_2 || c.timeSlot2 || '', c.timeSlot2_3 || c.timeSlot2 || '']
        : [c.timeSlot2 || '', c.timeSlot2 || '', c.timeSlot2 || ''];
      var v2Pairs = buildCandidatePairs_([c.v2c1, c.v2c2, c.v2c3], v2Slots, stype2);
      var v2Staff = (stype2 === 'オンライン') ? ONLINE_SA_STAFF : schoolStaff;
      allRequests.push({
        schoolName: c.schoolName,
        visitNum: 2,
        pairs: v2Pairs,
        supportType: stype2,
        fallbackSlotInfo: getSlotInfo_(stype2, v2Slots[0]),
        fallbackTimeSlot: v2Slots[0],
        staff: v2Staff,
        priority: priorityScores[c.schoolName] || 0
      });
    }
  }

  // --- 5. 割り当てアルゴリズム（2パス: 全Visit1 → 全Visit2） ---
  var scheduleRows = [];
  var newPriorityScores = {};

  function dayDiff(d1, d2) {
    return Math.abs((new Date(d1) - new Date(d2)) / 86400000);
  }

  // 支援員別の使用済みslot/稼働日マップ
  var staffUsedSlots = {};
  var staffWorkDaysMap = {};

  function getStaffEnv(staff) {
    if (!staffUsedSlots[staff]) staffUsedSlots[staff] = {};
    if (!staffWorkDaysMap[staff]) staffWorkDaysMap[staff] = getStaffWorkDays(staff);
    return { used: staffUsedSlots[staff], work: staffWorkDaysMap[staff] };
  }

  // 学校ごとの v1 確定日（v2 の間隔チェック用、担当SA違いに関わらず）
  var schoolV1DateMap = {};
  // 学校ごとに割り当て結果を記録
  var assignmentsBySchool = {};

  function assignRequest_(req, requireDistanceFrom, minDistance, fallbackDistance) {
    var env = getStaffEnv(req.staff);
    var assigned = null;

    // 第1〜第3候補を順に試す（候補ごとに対応する slotInfo / timeSlot を使う）
    for (var ci = 0; ci < req.pairs.length; ci++) {
      var p = req.pairs[ci];
      if (env.work.indexOf(p.date) !== -1 && canUseSlot_(env.used, p.date, p.slotInfo) &&
          (!requireDistanceFrom || dayDiff(requireDistanceFrom, p.date) >= minDistance)) {
        markSlotUsed_(env.used, p.date, p.slotInfo);
        assigned = { date: p.date, rank: '第' + (ci + 1) + '候補', timeSlot: p.timeSlot };
        break;
      }
    }

    // 候補外でも空きを探す（規定間隔、フォールバック slotInfo を使用）
    if (!assigned) {
      for (var wi = 0; wi < env.work.length; wi++) {
        var wd = env.work[wi];
        if (canUseSlot_(env.used, wd, req.fallbackSlotInfo) &&
            (!requireDistanceFrom || dayDiff(requireDistanceFrom, wd) >= minDistance)) {
          markSlotUsed_(env.used, wd, req.fallbackSlotInfo);
          assigned = { date: wd, rank: '自動割当', timeSlot: req.fallbackTimeSlot };
          newPriorityScores[req.schoolName] = (newPriorityScores[req.schoolName] || 0) + 2;
          break;
        }
      }
    }

    // 短い間隔で妥協
    if (!assigned && requireDistanceFrom && fallbackDistance && fallbackDistance < minDistance) {
      for (var wi = 0; wi < env.work.length; wi++) {
        var wd = env.work[wi];
        if (canUseSlot_(env.used, wd, req.fallbackSlotInfo) &&
            dayDiff(requireDistanceFrom, wd) >= fallbackDistance) {
          markSlotUsed_(env.used, wd, req.fallbackSlotInfo);
          assigned = { date: wd, rank: '自動割当(間隔短)', timeSlot: req.fallbackTimeSlot };
          break;
        }
      }
    }

    if (!assigned) {
      assigned = { date: '', rank: '割当不可', timeSlot: req.fallbackTimeSlot };
    }
    return assigned;
  }

  // === Pass 1: 全Visit1 を確定 ===
  var v1Requests = allRequests.filter(function(r) { return r.visitNum === 1; });
  v1Requests.sort(function(a, b) { return b.priority - a.priority; });

  for (var ri = 0; ri < v1Requests.length; ri++) {
    var req = v1Requests[ri];
    var result = assignRequest_(req, null, 0, 0);

    if (result.date) schoolV1DateMap[req.schoolName] = result.date;
    if (!assignmentsBySchool[req.schoolName]) assignmentsBySchool[req.schoolName] = [];
    assignmentsBySchool[req.schoolName].push({
      visitNum: 1, date: result.date, rank: result.rank,
      staff: req.staff, supportType: req.supportType, timeSlot: result.timeSlot
    });

    if (result.rank.indexOf('第1') === -1 && result.rank !== '割当不可' && result.rank.indexOf('自動割当') === -1) {
      newPriorityScores[req.schoolName] = (newPriorityScores[req.schoolName] || 0) + 1;
    }
  }

  // === Pass 2: 全Visit2 を確定（同一校の v1 から5日以上空ける、不可なら3日以上） ===
  var v2Requests = allRequests.filter(function(r) { return r.visitNum === 2; });
  v2Requests.sort(function(a, b) { return b.priority - a.priority; });

  for (var ri = 0; ri < v2Requests.length; ri++) {
    var req = v2Requests[ri];
    var v1Date = schoolV1DateMap[req.schoolName] || null;
    var result = assignRequest_(req, v1Date, 5, 3);

    if (!assignmentsBySchool[req.schoolName]) assignmentsBySchool[req.schoolName] = [];
    assignmentsBySchool[req.schoolName].push({
      visitNum: 2, date: result.date, rank: result.rank,
      staff: req.staff, supportType: req.supportType, timeSlot: result.timeSlot
    });

    if (result.rank.indexOf('第1') === -1 && result.rank !== '割当不可' && result.rank.indexOf('自動割当') === -1) {
      newPriorityScores[req.schoolName] = (newPriorityScores[req.schoolName] || 0) + 1;
    }
  }

  // === scheduleRows を構築 ===
  for (var sch in assignmentsBySchool) {
    var ass = assignmentsBySchool[sch];
    for (var k = 0; k < ass.length; k++) {
      var a = ass[k];
      if (!a.date) continue;
      scheduleRows.push([
        targetMonth, a.date, a.staff, sch,
        a.visitNum + '回目 ' + a.rank,
        '仮', '',
        a.timeSlot || '',
        a.supportType || '訪問'
      ]);
    }
  }

  // --- 6. スケジュールシートに書き込み ---
  var headers = ['対象年月', '日付', '支援員名', '学校名', '候補順位', 'ステータス', '元担当支援員', '時間帯', '支援種別'];
  var sheet = getOrCreateSheet_(SHEET_SCHEDULE, headers);
  ensureScheduleExtraColumns_(sheet);

  // 対象月の既存データをクリア
  var existing = sheet.getDataRange().getValues();
  for (var i = existing.length - 1; i >= 1; i--) {
    if (normalizeTargetMonth_(existing[i][0]) === targetMonth) {
      sheet.deleteRow(i + 1);
    }
  }

  if (scheduleRows.length > 0) {
    // 日付順にソート
    scheduleRows.sort(function(a, b) { return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0; });
    var insertRange = sheet.getRange(sheet.getLastRow() + 1, 1, scheduleRows.length, 9);
    insertRange.setNumberFormat('@');
    insertRange.setValues(scheduleRows);
  }

  // 優先スコアを保存
  savePriorityScores_(newPriorityScores);

  // 統計
  var v1Count = scheduleRows.filter(function(r) { return r[4].indexOf('1回目') !== -1; }).length;
  var v2Count = scheduleRows.filter(function(r) { return r[4].indexOf('2回目') !== -1; }).length;
  var visitCount = scheduleRows.filter(function(r) { return r[8] === '訪問'; }).length;
  var onlineCount = scheduleRows.filter(function(r) { return r[8] === 'オンライン'; }).length;

  return {
    success: true,
    message: 'スケジュール割り当て完了: 1回目=' + v1Count + '件, 2回目=' + v2Count +
             '件 / 訪問=' + visitCount + '件, オンライン=' + onlineCount +
             '件（合計' + scheduleRows.length + '件）'
  };
}

// ===== 手入力スケジュール（要望取得を行わない自治体向け） =====

var MANUAL_SCHED_HEADERS = ['ID', '対象年月', '日付', '支援員名', '学校名', '時間帯', '支援種別', 'ステータス', '自治体', '更新日時'];

function getOrCreateManualScheduleSheet_() {
  return getOrCreateSheet_(SHEET_MANUAL_SCHEDULE, MANUAL_SCHED_HEADERS);
}

// 対象月の手入力スケジュールを取得
function getManualSchedules_(targetMonth) {
  var sheet = getOrCreateManualScheduleSheet_();
  var data = sheet.getDataRange().getValues();
  var results = [];
  for (var i = 1; i < data.length; i++) {
    var m = normalizeTargetMonth_(data[i][1]);
    if (targetMonth && m !== targetMonth) continue;
    if (!data[i][0]) continue;
    results.push({
      id:           String(data[i][0]).trim(),
      targetMonth:  m,
      date:         normalizeCandidateDate_(data[i][2]),
      staffName:    String(data[i][3]).trim(),
      schoolName:   String(data[i][4]).trim(),
      timeSlot:     String(data[i][5]).trim(),
      supportType:  String(data[i][6]).trim(),
      status:       String(data[i][7] || '仮').trim(),
      municipality: String(data[i][8] || '').trim(),
      updatedAt:    data[i][9] instanceof Date
        ? Utilities.formatDate(data[i][9], 'Asia/Tokyo', 'yyyy/MM/dd HH:mm')
        : String(data[i][9] || '')
    });
  }
  return results;
}

// クライアント呼出用ラッパ
function getManualSchedules(targetMonth) {
  return getManualSchedules_(targetMonth);
}

// 自治体マスタ的に、学校マスタから「手入力」カテゴリの学校だけを返す
function getManualScopedSchools() {
  var all = getAllSchools_();
  return all.filter(function(s) { return s.supportCategory === '手入力'; });
}

// 1件追加
function addManualSchedule(entry) {
  if (!entry || !entry.date || !entry.staffName || !entry.schoolName) {
    return { success: false, message: '日付・支援員・学校は必須です' };
  }
  var sheet = getOrCreateManualScheduleSheet_();
  var id = Utilities.getUuid();
  var school = getSchoolByName_(entry.schoolName);
  var municipality = entry.municipality || (school ? school.municipality : '');
  var row = [
    id,
    entry.targetMonth || '',
    entry.date,
    entry.staffName,
    entry.schoolName,
    entry.timeSlot || '',
    entry.supportType || '訪問',
    entry.status || '仮',
    municipality,
    new Date()
  ];
  var nextRow = sheet.getLastRow() + 1;
  sheet.getRange(nextRow, 1, 1, row.length).setNumberFormat('@').setValues([row]);
  sheet.getRange(nextRow, 10).setNumberFormat('yyyy/mm/dd hh:mm');
  return { success: true, id: id };
}

// 1件更新
function updateManualSchedule(id, entry) {
  if (!id) return { success: false, message: 'IDが指定されていません' };
  var sheet = getOrCreateManualScheduleSheet_();
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === id) {
      var rowNum = i + 1;
      if (entry.date != null)        sheet.getRange(rowNum, 3).setValue(entry.date);
      if (entry.staffName != null)   sheet.getRange(rowNum, 4).setValue(entry.staffName);
      if (entry.schoolName != null)  sheet.getRange(rowNum, 5).setValue(entry.schoolName);
      if (entry.timeSlot != null)    sheet.getRange(rowNum, 6).setValue(entry.timeSlot);
      if (entry.supportType != null) sheet.getRange(rowNum, 7).setValue(entry.supportType);
      if (entry.status != null)      sheet.getRange(rowNum, 8).setValue(entry.status);
      if (entry.municipality != null) sheet.getRange(rowNum, 9).setValue(entry.municipality);
      sheet.getRange(rowNum, 10).setValue(new Date());
      return { success: true };
    }
  }
  return { success: false, message: '該当エントリが見つかりません' };
}

// 1件削除
function deleteManualSchedule(id) {
  if (!id) return { success: false, message: 'IDが指定されていません' };
  var sheet = getOrCreateManualScheduleSheet_();
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]).trim() === id) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, message: '該当エントリが見つかりません' };
}

// 手入力スケジュールのサンプルデータ生成（対象月の翌月用にN件追加）
function setupSampleManualSchedule(targetMonth) {
  if (!targetMonth) {
    var settings = getSystemSettings_();
    targetMonth = settings.targetMonth || '2026-06';
  }
  var schools = getManualScopedSchools();
  if (schools.length === 0) return { success: false, message: '手入力カテゴリの学校がありません' };

  var parts = targetMonth.split('-');
  var year = parseInt(parts[0], 10);
  var month = parseInt(parts[1], 10);
  var weekdays = getWeekdaysInMonth_(year, month);
  if (weekdays.length === 0) return { success: false, message: '対象月の平日がありません' };

  var sheet = getOrCreateManualScheduleSheet_();
  var added = 0;
  for (var i = 0; i < schools.length; i++) {
    var sch = schools[i];
    var rand = seededRand_(parseInt(sch.schoolCode) * 13 + 7);
    // 各校2件
    var picked = pick3Dates_(weekdays, rand);
    var slots = ['09:00-12:00', '13:30-16:30'];
    for (var k = 0; k < 2; k++) {
      var d = picked[k];
      if (!d) continue;
      var row = [
        Utilities.getUuid(), targetMonth, d, sch.staffName, sch.schoolName,
        slots[k % 2], '訪問', '仮', sch.municipality, new Date()
      ];
      var nextRow = sheet.getLastRow() + 1;
      sheet.getRange(nextRow, 1, 1, row.length).setNumberFormat('@').setValues([row]);
      sheet.getRange(nextRow, 10).setNumberFormat('yyyy/mm/dd hh:mm');
      added++;
    }
  }
  return { success: true, message: '手入力スケジュール サンプル投入: ' + added + '件（対象月: ' + targetMonth + '）' };
}

// ===== レビュー用機能 =====

function resetAllData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetNames = [SHEET_USERS, SHEET_CANDIDATES, SHEET_SCHEDULE, SHEET_PRIORITY,
                    SHEET_HOLIDAYS, SHEET_MEETINGS, SHEET_STAFF_OFF, SHEET_MANUAL_SCHEDULE];
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

// （旧 setupSampleDataJune2026 [福岡市版] は削除されました。
//  鹿児島用の 6月+7月 サンプルデータ生成は setupSampleDataJunJul2026() を使用してください）
