function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = JSON.parse(e.postData.contents);
  sheet.appendRow([
    data.order_date,
    data.customer_name,
    data.customer_phone,
    data.customer_location,
    data.items,
    data.total,
    data.currency,
    data.customer_note
  ]);
  return ContentService.createTextOutput('OK');
}