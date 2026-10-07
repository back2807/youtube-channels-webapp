const SPREADSHEET_ID = '1OjdDlTVDvM19sp51qpVpVlFEhBoubvGu_lFYaJ5F9uM';
const SHEET_NAME = 'Display'; // Lấy dữ liệu từ sheet Display
const LOG_SHEET_NAME = 'Lịch sử GD';

function doGet(e) {
  // 1. Phục vụ API dữ liệu JSON cho GitHub Pages hoặc ứng dụng bên ngoài
  if (e && e.parameter) {
    if (e.parameter.action === 'getData' || e.parameter.api === 'true' || e.parameter.json === 'true') {
      const data = getChannelsData();
      return ContentService.createTextOutput(JSON.stringify(data))
          .setMimeType(ContentService.MimeType.JSON);
    }
    if (e.parameter.action === 'saveCustomer') {
      saveCustomerInfo(e.parameter.channelId, e.parameter.email, e.parameter.phone);
      return ContentService.createTextOutput(JSON.stringify({success: true}))
          .setMimeType(ContentService.MimeType.JSON);
    }
  }

  // 2. Mặc định: Trả về trang HTML cho môi trường Apps Script
  const template = HtmlService.createTemplateFromFile('index');
  return template.evaluate()
      .setTitle('DANH SÁCH KÊNH YOUTUBE')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Hàm hỗ trợ Cache dữ liệu lớn
function getCachedData() {
  const cache = CacheService.getScriptCache();
  const chunksStr = cache.get("CHANNELS_CHUNKS");
  if (!chunksStr) return null;
  
  const chunks = parseInt(chunksStr, 10);
  let dataStr = "";
  for (let i = 0; i < chunks; i++) {
    const chunk = cache.get("CHANNELS_DATA_" + i);
    if (!chunk) return null; // Thiếu chunk thì coi như mất cache
    dataStr += chunk;
  }
  return JSON.parse(dataStr);
}

function setCachedData(dataArray) {
  const cache = CacheService.getScriptCache();
  const dataStr = JSON.stringify(dataArray);
  const chunkSize = 40000; // Giới hạn an toàn < 100KB (Đã giảm xuống 40000 để ngừa lỗi ký tự Unicode tiếng Việt)
  const chunks = Math.ceil(dataStr.length / chunkSize);
  
  cache.put("CHANNELS_CHUNKS", chunks.toString(), 30); // Tự động cập nhật mỗi 30s
  for (let i = 0; i < chunks; i++) {
    cache.put("CHANNELS_DATA_" + i, dataStr.substring(i * chunkSize, (i + 1) * chunkSize), 30);
  }
}

function clearCache() {
  const cache = CacheService.getScriptCache();
  cache.remove("CHANNELS_CHUNKS");
}

function getChannelsData() {
  try {
    // 1. Cố gắng lấy từ Cache phân mảnh
    const cachedData = getCachedData();
    if (cachedData) {
      return cachedData;
    }

    // 2. Nếu không có cache, truy vấn từ Google Sheet
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return [];
    
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return [];
  
  const headers = data[0].map(h => h.toString().trim());
  const rows = data.slice(1);
  
  // Cache index các cột linh hoạt dựa vào từ khóa
  const colIndex = {
    title: headers.findIndex(h => {
        let t = h.toLowerCase();
        return t.includes('title') || t.includes('tiêu đề') || t.includes('tên kênh');
    }),
    link: headers.findIndex(h => h.toLowerCase().includes('link kênh')),
    image: headers.findIndex(h => {
        let t = h.toLowerCase();
        return t.includes('link drive') || t.includes('ảnh');
    }),
    monetization: headers.findIndex(h => h.toLowerCase().includes('kiếm tiền')),
    subs: headers.findIndex(h => {
        let t = h.toLowerCase();
        return t.includes('subscriber') || t.includes('sub') || t.includes('đăng ký');
    }),
    country: headers.findIndex(h => h.toLowerCase().includes('quốc gia')),
    price: headers.findIndex(h => h.toLowerCase().includes('giá')),
    status: headers.findIndex(h => h.toLowerCase().includes('trạng thái')),
    age: headers.findIndex(h => h.toLowerCase().includes('kênh cổ')),
    id: headers.findIndex(h => {
        let t = h.toLowerCase();
        return t === 'id' || t.includes('channel id') || t.includes('mã kênh');
    })
  };

  const channels = [];
  rows.forEach((row, index) => {
    const status = colIndex.status !== -1 ? row[colIndex.status].toString() : '';
    if (status.toUpperCase().trim() === 'ĐÃ BÁN') return; 
    
    let channelId = colIndex.id !== -1 ? row[colIndex.id].toString().trim() : '';
    if (!channelId && colIndex.link !== -1) {
      let url = row[colIndex.link].toString();
      let match = url.match(/(?:channel\/|c\/|user\/|@)([^\/\?]+)/);
      if (match) channelId = match[1];
    }
    
    let rawPrice = colIndex.price !== -1 ? row[colIndex.price] : '0';
    let numPrice = parseInt(rawPrice.toString().replace(/[^0-9]/g, '')) || 0;

    let rawSubs = colIndex.subs !== -1 ? row[colIndex.subs] : '0';
    let numSubs = parseInt(rawSubs.toString().replace(/[^0-9]/g, '')) || 0;

    channels.push({
      id: channelId,
      title: colIndex.title !== -1 ? row[colIndex.title].toString() : '',
      link: colIndex.link !== -1 ? row[colIndex.link].toString() : '',
      image: colIndex.image !== -1 ? row[colIndex.image].toString() : '',
      monetization: colIndex.monetization !== -1 ? row[colIndex.monetization].toString() : '',
      age: colIndex.age !== -1 ? row[colIndex.age].toString() : '',
      subs: numSubs,
      rawSubs: rawSubs,
      country: colIndex.country !== -1 ? row[colIndex.country].toString() : '',
      price: numPrice,
      rawPrice: rawPrice
    });
  });
  
    // 3. Lưu mảng data vào Cache phân mảnh
    setCachedData(channels);

    return channels;
  } catch (err) {
    return [{
      id: "LỖI BACKEND",
      title: "CÓ LỖI XẢY RA: " + err.toString(),
      price: 0,
      subs: 0,
      country: "N/A"
    }];
  }
}

/**
 * Webhook từ SePay
 */
function doPost(e) {
  try {
    const postData = JSON.parse(e.postData.contents);
    const txn = postData;
    
    if (!txn.id || txn.transferAmount === undefined) {
      return ContentService.createTextOutput(JSON.stringify({success: false, message: "Invalid payload"})).setMimeType(ContentService.MimeType.JSON);
    }
    
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    
    let logSheet = ss.getSheetByName(LOG_SHEET_NAME);
    if (!logSheet) {
       logSheet = ss.insertSheet(LOG_SHEET_NAME);
       logSheet.appendRow(["Thời gian", "Mã giao dịch", "Nội dung", "Số tiền", "Loại giao dịch"]);
       logSheet.getRange("A1:E1").setFontWeight("bold").setBackground("#d9ead3");
    }
    
    logSheet.appendRow([
       txn.transactionDate,
       txn.referenceCode || txn.id,
       txn.content,
       txn.transferAmount,
       txn.transferType
    ]);

    if (txn.transferType === "in") {
      const sheet = ss.getSheetByName(SHEET_NAME);
      const data = sheet.getDataRange().getValues();
      const headers = data[0].map(h => h.toString().trim());
      
      const idColIndex = headers.findIndex(h => {
        let t = h.toLowerCase();
        return t === 'id' || t.includes('channel id') || t.includes('mã kênh');
      });
      const linkColIndex = headers.findIndex(h => h.toLowerCase().includes('link kênh'));
      const statusColIndex = headers.findIndex(h => h.toLowerCase().includes('trạng thái'));
      
      if (statusColIndex !== -1) {
        const description = (txn.content || txn.description || "").toUpperCase();
        
        for (let i = 1; i < data.length; i++) {
          let channelId = idColIndex !== -1 ? data[i][idColIndex].toString().trim() : '';
          
          if (!channelId && linkColIndex !== -1) {
            let url = data[i][linkColIndex].toString();
            let match = url.match(/(?:channel\/|c\/|user\/|@)([^\/\?]+)/);
            if (match) channelId = match[1];
          }
          
          if (channelId && description.includes(channelId.toUpperCase())) {
            sheet.getRange(i + 1, statusColIndex + 1).setValue("ĐÃ THANH TOÁN");
            // Xóa cache vì dữ liệu đã thay đổi
            clearCache(); 
          }
        }
      }
    }
    
    return ContentService.createTextOutput(JSON.stringify({success: true})).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({success: false, message: err.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}

// Hàm lưu thông tin khách hàng vào Sheet
function saveCustomerInfo(channelId, email, phone) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName('Thông tin Khách');
    if (!sheet) {
      sheet = ss.insertSheet('Thông tin Khách');
      sheet.appendRow(["Thời gian", "Mã Kênh", "Email", "Số điện thoại"]);
      sheet.getRange("A1:D1").setFontWeight("bold").setBackground("#d9ead3");
    }
    const dateStr = Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss");
    sheet.appendRow([dateStr, channelId, email, phone]);
  } catch (e) {
    console.error("Lỗi khi lưu thông tin: ", e);
  }
}
