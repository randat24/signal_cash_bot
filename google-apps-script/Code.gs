// Signal Cash — веб-приложение Google Apps Script для хранения сигналов в Google Таблице.
// Установка: Таблица → Расширения → Apps Script → вставить этот файл →
// Развернуть → Новое развёртывание → Веб-приложение (запуск от моего имени, доступ: «Все").
// URL развёртывания вставьте в приложение: «Google Таблица» → «URL веб-приложения».

// Необязательный секрет. Если задан, тот же токен нужно указать в приложении.
var TOKEN = '';
var SHEET_NAME = 'Signals';
var FIELDS = ['id', 'date', 'ticker', 'market', 'direction', 'entry', 'stopLoss',
  'takeProfit', 'exitPrice', 'size', 'status', 'source', 'note'];

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(FIELDS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function checkToken_(e) {
  return !TOKEN || (e && e.parameter && e.parameter.token === TOKEN);
}

function doGet(e) {
  if (!checkToken_(e)) return json_({ error: 'Неверный токен' });
  var sheet = getSheet_();
  var values = sheet.getDataRange().getValues();
  var header = values.shift() || FIELDS;
  var idCol = header.indexOf('id');
  var signals = values
    .map(function (row, r) {
      // Строкам, добавленным вручную, присваиваем постоянный id, чтобы не плодить дубли.
      if (idCol >= 0 && row.join('') !== '' && !row[idCol]) {
        row[idCol] = Utilities.getUuid();
        sheet.getRange(r + 2, idCol + 1).setNumberFormat('@').setValue(row[idCol]);
      }
      return row;
    })
    .filter(function (row) { return row.join('') !== ''; })
    .map(function (row) {
      var obj = {};
      header.forEach(function (h, i) {
        var v = row[i];
        obj[h] = v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm") : v;
      });
      return obj;
    });
  return json_({ signals: signals });
}

function doPost(e) {
  if (!checkToken_(e)) return json_({ error: 'Неверный токен' });
  var payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ error: 'Некорректный JSON' });
  }
  var signals = payload.signals || [];
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet_();
    sheet.clearContents();
    var rows = [FIELDS].concat(signals.map(function (s) {
      return FIELDS.map(function (f) { return s[f] === null || s[f] === undefined ? '' : s[f]; });
    }));
    // Даты и id храним как текст, чтобы Таблица их не переформатировала.
    sheet.getRange(1, 1, rows.length, 2).setNumberFormat('@');
    sheet.getRange(1, 1, rows.length, FIELDS.length).setValues(rows);
    sheet.setFrozenRows(1);
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true, count: signals.length });
}
