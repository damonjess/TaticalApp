/* OUI Mini Database — MAC Address Vendor Lookup
   First 3 octets (6 hex chars) → Manufacturer name */
window.OUI_DB = {
    // Apple
    '00:03:93':'Apple','00:05:02':'Apple','00:0A:27':'Apple','00:0A:95':'Apple',
    '00:0D:93':'Apple','00:10:FA':'Apple','00:11:24':'Apple','00:14:51':'Apple',
    '00:16:CB':'Apple','00:17:F2':'Apple','00:19:E3':'Apple','00:1B:63':'Apple',
    '00:1C:B3':'Apple','00:1D:4F':'Apple','00:1E:52':'Apple','00:1E:C2':'Apple',
    '00:1F:5B':'Apple','00:1F:F3':'Apple','00:21:E9':'Apple','00:22:41':'Apple',
    '00:23:12':'Apple','00:23:32':'Apple','00:23:6C':'Apple','00:23:DF':'Apple',
    '00:24:36':'Apple','00:25:00':'Apple','00:25:4B':'Apple','00:25:BC':'Apple',
    '00:26:08':'Apple','00:26:4A':'Apple','00:26:B0':'Apple','00:26:BB':'Apple',
    '00:3E:E1':'Apple','00:50:E4':'Apple','00:56:CD':'Apple','00:61:71':'Apple',
    '00:88:65':'Apple','00:B3:62':'Apple','00:C6:10':'Apple','00:CD:FE':'Apple',
    '00:DB:70':'Apple','00:F4:B9':'Apple','00:F7:6F':'Apple','04:0C:CE':'Apple',
    '04:15:52':'Apple','04:1B:BA':'Apple','04:26:65':'Apple','04:48:9A':'Apple',
    '04:4B:ED':'Apple','04:52:F3':'Apple','04:54:53':'Apple','04:69:F8':'Apple',
    '04:D3:CF':'Apple','04:DB:56':'Apple','04:E5:36':'Apple','04:F1:3E':'Apple',
    '04:F7:E4':'Apple','08:00:07':'Apple','08:66:98':'Apple','08:6D:41':'Apple',
    '10:40:F3':'Apple','10:41:7F':'Apple','10:9A:DD':'Apple','10:DD:B1':'Apple',
    '14:10:9F':'Apple','14:20:5E':'Apple','14:5A:05':'Apple','14:8F:C6':'Apple',
    '14:99:E2':'Apple','18:34:51':'Apple','18:65:90':'Apple','18:9E:FC':'Apple',
    '18:AF:61':'Apple','18:E7:F4':'Apple','18:EE:69':'Apple','18:F6:43':'Apple',
    '1C:1A:C0':'Apple','1C:36:BB':'Apple','1C:5F:2B':'Apple','1C:91:48':'Apple',
    '1C:E6:2B':'Apple','20:3C:AE':'Apple','20:78:F0':'Apple','20:A2:E4':'Apple',
    '20:AB:37':'Apple','20:C9:D0':'Apple','24:24:0E':'Apple','24:AB:81':'Apple',
    '24:F0:94':'Apple','28:0B:5C':'Apple','28:37:37':'Apple','28:5A:EB':'Apple',
    '28:6A:B8':'Apple','28:6A:BA':'Apple','28:CF:DA':'Apple','28:CF:E9':'Apple',
    '28:E0:2C':'Apple','28:E1:4C':'Apple','28:E7:CF':'Apple','28:ED:6A':'Apple',

    // Samsung
    '00:00:F0':'Samsung','00:02:78':'Samsung','00:07:AB':'Samsung','00:09:18':'Samsung',
    '00:0D:E5':'Samsung','00:12:47':'Samsung','00:12:FB':'Samsung','00:13:77':'Samsung',
    '00:15:99':'Samsung','00:15:B9':'Samsung','00:16:32':'Samsung','00:16:6B':'Samsung',
    '00:16:6C':'Samsung','00:16:DB':'Samsung','00:17:C9':'Samsung','00:17:D5':'Samsung',
    '00:18:AF':'Samsung','00:1A:8A':'Samsung','00:1B:98':'Samsung','00:1C:43':'Samsung',
    '00:1D:25':'Samsung','00:1D:F6':'Samsung','00:1E:75':'Samsung','00:1F:CC':'Samsung',
    '00:1F:CD':'Samsung','00:21:19':'Samsung','00:21:4C':'Samsung','00:21:D1':'Samsung',
    '00:21:D2':'Samsung','00:23:39':'Samsung','00:23:3A':'Samsung','00:23:99':'Samsung',
    '00:23:D6':'Samsung','00:23:D7':'Samsung','00:24:54':'Samsung','00:24:90':'Samsung',
    '00:24:91':'Samsung','00:24:E9':'Samsung','00:25:66':'Samsung','00:25:67':'Samsung',
    '00:26:37':'Samsung','00:26:5D':'Samsung','00:26:5F':'Samsung',
    '08:37:3D':'Samsung','08:D4:2B':'Samsung','08:EE:8B':'Samsung','08:FC:88':'Samsung',
    '0C:14:20':'Samsung','0C:71:5D':'Samsung','0C:DF:A4':'Samsung',
    '10:1D:C0':'Samsung','10:30:47':'Samsung','10:D5:42':'Samsung',
    '14:49:E0':'Samsung','14:89:FD':'Samsung','14:A3:64':'Samsung','14:BB:6E':'Samsung',
    '18:16:C9':'Samsung','18:21:95':'Samsung','18:22:7E':'Samsung','18:3A:2D':'Samsung',
    '18:67:B0':'Samsung','18:69:D8':'Samsung','18:83:31':'Samsung',
    '1C:62:B8':'Samsung','1C:66:AA':'Samsung',

    // Huawei
    '00:1E:10':'Huawei','00:18:82':'Huawei','00:22:A1':'Huawei','00:25:68':'Huawei',
    '00:25:9E':'Huawei','00:34:FE':'Huawei','00:46:4B':'Huawei','00:5A:13':'Huawei',
    '00:66:4B':'Huawei','00:9A:CD':'Huawei','00:E0:FC':'Huawei',
    '04:02:1F':'Huawei','04:27:58':'Huawei','04:33:89':'Huawei','04:4F:4C':'Huawei',
    '04:B0:E7':'Huawei','04:C0:6F':'Huawei','04:F9:38':'Huawei',
    '08:19:A6':'Huawei','08:63:61':'Huawei','08:7A:4C':'Huawei','08:E8:4F':'Huawei',
    '0C:37:DC':'Huawei','0C:45:BA':'Huawei','0C:96:BF':'Huawei',
    '10:44:00':'Huawei','10:47:80':'Huawei','10:C6:1F':'Huawei',
    '14:30:04':'Huawei','14:57:9F':'Huawei','14:A0:F8':'Huawei','14:B9:68':'Huawei',

    // Xiaomi
    '00:9E:C8':'Xiaomi','04:CF:8C':'Xiaomi','0C:1D:AF':'Xiaomi',
    '10:2A:B3':'Xiaomi','14:F6:5A':'Xiaomi','18:59:36':'Xiaomi',
    '1C:BF:CE':'Xiaomi','20:47:47':'Xiaomi','24:16:8F':'Xiaomi',
    '28:6C:07':'Xiaomi','28:E3:1F':'Xiaomi','2C:58:4F':'Xiaomi',
    '34:80:B3':'Xiaomi','34:CE:00':'Xiaomi','38:A4:ED':'Xiaomi',
    '3C:BD:3E':'Xiaomi','40:31:3C':'Xiaomi','44:23:7C':'Xiaomi',
    '48:A9:D2':'Xiaomi','4C:49:E3':'Xiaomi','50:64:2B':'Xiaomi',
    '50:8F:4C':'Xiaomi','54:48:E6':'Xiaomi','58:44:98':'Xiaomi',
    '5C:B1:3E':'Xiaomi','60:AB:67':'Xiaomi','64:09:80':'Xiaomi',
    '64:B4:73':'Xiaomi','64:CC:2E':'Xiaomi','68:28:BA':'Xiaomi',
    '6C:5A:B5':'Xiaomi','70:2A:D5':'Xiaomi','74:23:44':'Xiaomi',
    '74:51:BA':'Xiaomi','78:02:F8':'Xiaomi','78:11:DC':'Xiaomi',

    // Google
    '08:9E:08':'Google','1C:F2:9A':'Google','30:FD:38':'Google',
    '3C:5A:B4':'Google','54:60:09':'Google','58:CB:52':'Google',
    '94:EB:2C':'Google','A4:77:33':'Google','D4:F5:47':'Google','F4:F5:D8':'Google',
    'F4:F5:E8':'Google','F8:8F:CA':'Google',

    // Amazon
    '00:FC:8B':'Amazon','0C:47:C9':'Amazon','10:CE:A9':'Amazon',
    '18:74:2E':'Amazon','34:D2:70':'Amazon','38:F7:3D':'Amazon',
    '3C:5C:C4':'Amazon','40:A2:DB':'Amazon','44:65:0D':'Amazon',
    '50:DC:E7':'Amazon','54:4A:16':'Amazon','68:37:E9':'Amazon',
    '68:54:FD':'Amazon','6C:56:97':'Amazon','74:75:48':'Amazon',
    '74:C2:46':'Amazon','78:E1:03':'Amazon','84:D6:D0':'Amazon',
    '8C:AE:4C':'Amazon','A0:02:DC':'Amazon','AC:63:BE':'Amazon',
    'B0:FC:0D':'Amazon','B4:7C:9C':'Amazon','CC:F7:35':'Amazon',
    'F0:27:2D':'Amazon','F0:D2:F1':'Amazon','F0:F0:A4':'Amazon',
    'FC:65:DE':'Amazon','FE:27:2D':'Amazon',

    // TP-Link
    '00:31:92':'TP-Link','14:CC:20':'TP-Link','14:CF:92':'TP-Link',
    '18:A6:F7':'TP-Link','1C:3B:F3':'TP-Link','30:B5:C2':'TP-Link',
    '50:3E:AA':'TP-Link','50:C7:BF':'TP-Link','54:C8:0F':'TP-Link',
    '5C:A6:E6':'TP-Link','60:32:B1':'TP-Link','64:56:01':'TP-Link',
    '64:66:B3':'TP-Link','68:FF:7B':'TP-Link','6C:5A:B0':'TP-Link',
    '78:44:76':'TP-Link','80:8D:B7':'TP-Link','84:16:F9':'TP-Link',
    '90:F6:52':'TP-Link','98:DA:C4':'TP-Link','A0:F3:C1':'TP-Link',
    'A4:2B:B0':'TP-Link','AC:15:A2':'TP-Link','B0:4E:26':'TP-Link',
    'B0:95:75':'TP-Link','B4:B0:24':'TP-Link','C0:06:C3':'TP-Link',
    'C0:25:E9':'TP-Link','C4:E9:84':'TP-Link','CC:32:E5':'TP-Link',
    'D4:6E:0E':'TP-Link','D8:07:B6':'TP-Link','D8:47:32':'TP-Link',
    'E4:C3:2A':'TP-Link','E8:48:B8':'TP-Link','EC:08:6B':'TP-Link',
    'EC:17:2F':'TP-Link','F0:A7:31':'TP-Link','F4:EC:38':'TP-Link',
    'F4:F2:6D':'TP-Link','F8:1A:67':'TP-Link','F8:D1:11':'TP-Link',

    // ASUS
    '00:0C:6E':'ASUS','00:0E:A6':'ASUS','00:11:2F':'ASUS','00:11:D8':'ASUS',
    '00:13:D4':'ASUS','00:15:F2':'ASUS','00:17:31':'ASUS','00:18:F3':'ASUS',
    '00:1A:92':'ASUS','00:1B:FC':'ASUS','00:1D:60':'ASUS','00:1E:8C':'ASUS',
    '00:1F:C6':'ASUS','00:22:15':'ASUS','00:23:54':'ASUS','00:24:8C':'ASUS',
    '00:25:22':'ASUS','00:26:18':'ASUS','04:92:26':'ASUS','08:60:6E':'ASUS',
    '0C:9D:92':'ASUS','10:7B:44':'ASUS','10:BF:48':'ASUS','10:C3:7B':'ASUS',
    '14:DA:E9':'ASUS','14:DD:A9':'ASUS','1C:87:2C':'ASUS','1C:B7:2C':'ASUS',
    '2C:4D:54':'ASUS','2C:56:DC':'ASUS','2C:FD:A1':'ASUS','30:5A:3A':'ASUS',
    '30:85:A9':'ASUS','34:97:F6':'ASUS','38:2C:4A':'ASUS','38:D5:47':'ASUS',

    // Netgear
    '00:09:5B':'Netgear','00:0F:B5':'Netgear','00:14:6C':'Netgear',
    '00:18:4D':'Netgear','00:1B:2F':'Netgear','00:1E:2A':'Netgear',
    '00:1F:33':'Netgear','00:22:3F':'Netgear','00:24:B2':'Netgear',
    '00:26:F2':'Netgear','04:A1:51':'Netgear','08:02:8E':'Netgear',
    '08:BD:43':'Netgear','10:0C:6B':'Netgear','10:0D:7F':'Netgear',
    '20:0C:C8':'Netgear','20:E5:2A':'Netgear','28:80:88':'Netgear',
    '2C:B0:5D':'Netgear','30:46:9A':'Netgear','38:94:ED':'Netgear',
    '3C:37:86':'Netgear','44:94:FC':'Netgear','4C:60:DE':'Netgear',
    '6C:B0:CE':'Netgear','84:1B:5E':'Netgear','9C:3D:CF':'Netgear',
    'A0:04:60':'Netgear','A0:21:B7':'Netgear','A4:2B:8C':'Netgear',
    'B0:7F:B9':'Netgear','C0:3F:0E':'Netgear','C4:04:15':'Netgear',
    'CC:40:D0':'Netgear','E0:46:9A':'Netgear','E0:91:F5':'Netgear',
    'E4:F4:C6':'Netgear','F8:73:94':'Netgear',

    // D-Link
    '00:05:5D':'D-Link','00:0D:88':'D-Link','00:0F:3D':'D-Link',
    '00:11:95':'D-Link','00:13:46':'D-Link','00:15:E9':'D-Link',
    '00:17:9A':'D-Link','00:19:5B':'D-Link','00:1B:11':'D-Link',
    '00:1C:F0':'D-Link','00:1E:58':'D-Link','00:1F:1F':'D-Link',
    '00:21:91':'D-Link','00:22:B0':'D-Link','00:24:01':'D-Link',
    '00:26:5A':'D-Link','00:50:BA':'D-Link','04:BA:D6':'D-Link',
    '1C:7E:E5':'D-Link','28:10:7B':'D-Link','34:08:04':'D-Link',
    '78:54:2E':'D-Link','84:C9:B2':'D-Link','90:94:E4':'D-Link',
    'B8:A3:86':'D-Link','BC:F6:85':'D-Link','C0:A0:BB':'D-Link',
    'C4:A8:1D':'D-Link','CC:B2:55':'D-Link','F0:7D:68':'D-Link',

    // Intel
    '00:02:B3':'Intel','00:03:47':'Intel','00:04:23':'Intel',
    '00:07:E9':'Intel','00:0C:F1':'Intel','00:0E:0C':'Intel',
    '00:0E:35':'Intel','00:11:11':'Intel','00:13:02':'Intel',
    '00:13:20':'Intel','00:13:CE':'Intel','00:13:E8':'Intel',
    '00:15:00':'Intel','00:15:17':'Intel','00:16:6F':'Intel',
    '00:16:76':'Intel','00:16:EA':'Intel','00:16:EB':'Intel',
    '00:18:DE':'Intel','00:19:D1':'Intel','00:19:D2':'Intel',
    '00:1B:21':'Intel','00:1B:77':'Intel','00:1C:BF':'Intel',
    '00:1C:C0':'Intel','00:1D:E0':'Intel','00:1D:E1':'Intel',
    '00:1E:64':'Intel','00:1E:65':'Intel','00:1E:67':'Intel',
    '00:1F:3B':'Intel','00:1F:3C':'Intel','00:20:7B':'Intel',
    '00:21:5C':'Intel','00:21:5D':'Intel','00:21:6A':'Intel',
    '00:21:6B':'Intel','00:22:FA':'Intel','00:22:FB':'Intel',
    '00:23:14':'Intel','00:23:15':'Intel','00:24:D6':'Intel',
    '00:24:D7':'Intel','00:26:C6':'Intel','00:26:C7':'Intel',

    // Microsoft
    '00:0D:3A':'Microsoft','00:12:5A':'Microsoft','00:15:5D':'Microsoft',
    '00:17:FA':'Microsoft','00:1D:D8':'Microsoft','00:22:48':'Microsoft',
    '00:25:AE':'Microsoft','00:50:F2':'Microsoft','28:18:78':'Microsoft',
    '3C:83:75':'Microsoft','48:50:73':'Microsoft','50:1A:C5':'Microsoft',
    '58:82:A8':'Microsoft','60:45:BD':'Microsoft','7C:1E:52':'Microsoft',
    '7C:ED:8D':'Microsoft','80:EA:96':'Microsoft','8C:8D:28':'Microsoft',
    'B4:0E:DE':'Microsoft','B8:31:B5':'Microsoft','BC:83:85':'Microsoft',
    'C8:3F:26':'Microsoft','C8:5B:76':'Microsoft','D8:B3:70':'Microsoft',

    // LG Electronics
    '00:05:C9':'LG','00:1C:62':'LG','00:1E:75':'LG','00:1F:6B':'LG',
    '00:1F:E3':'LG','00:21:FB':'LG','00:22:A9':'LG','00:24:83':'LG',
    '00:25:E5':'LG','00:26:E2':'LG','00:34:DA':'LG','00:AA:70':'LG',
    '00:E0:91':'LG','08:08:C2':'LG','10:68:3F':'LG','10:F9:6F':'LG',
    '14:C9:13':'LG','18:67:B0':'LG','1C:BC:D0':'LG','20:21:A5':'LG',
    '20:3D:BD':'LG','28:C6:3F':'LG','2C:54:91':'LG','30:19:66':'LG',

    // Sony
    '00:01:4A':'Sony','00:04:1F':'Sony','00:13:A9':'Sony',
    '00:15:C1':'Sony','00:18:13':'Sony','00:19:63':'Sony',
    '00:1A:80':'Sony','00:1D:BA':'Sony','00:1E:A4':'Sony',
    '00:21:4F':'Sony','00:23:F1':'Sony','00:24:BE':'Sony',
    '00:24:EF':'Sony','04:5D:4B':'Sony','04:76:6E':'Sony',
    '10:A5:D0':'Sony','28:0D:FC':'Sony','2C:33:61':'Sony',
    '30:17:C8':'Sony','40:B8:37':'Sony','44:74:6C':'Sony',
    '54:42:49':'Sony','58:48:22':'Sony','70:9E:29':'Sony',

    // Philips Hue / IoT
    '00:17:88':'Philips Hue','EC:B5:FA':'Philips Hue',

    // Sonos
    '00:0E:58':'Sonos','34:7E:5C':'Sonos','48:A6:B8':'Sonos',
    '54:2A:1B':'Sonos','5C:AA:FD':'Sonos','78:28:CA':'Sonos',
    '94:9F:3E':'Sonos','B8:E9:37':'Sonos',

    // Ring / Nest
    '18:B4:30':'Nest','64:16:66':'Nest','AC:37:43':'Google Nest',
    '1C:F2:9A':'Google Nest','D4:73:D7':'Ring','B0:09:DA':'Ring',

    // Espressif (ESP32/ESP8266 IoT)
    '08:3A:F2':'Espressif','10:52:1C':'Espressif','18:FE:34':'Espressif',
    '24:0A:C4':'Espressif','24:62:AB':'Espressif','24:6F:28':'Espressif',
    '24:B2:DE':'Espressif','2C:3A:E8':'Espressif','2C:F4:32':'Espressif',
    '30:AE:A4':'Espressif','3C:61:05':'Espressif','3C:71:BF':'Espressif',
    '40:F5:20':'Espressif','48:3F:DA':'Espressif','4C:11:AE':'Espressif',
    '4C:75:25':'Espressif','50:02:91':'Espressif','54:43:B2':'Espressif',
    '5C:CF:7F':'Espressif','60:01:94':'Espressif','68:C6:3A':'Espressif',
    '70:03:9F':'Espressif','78:21:84':'Espressif','7C:9E:BD':'Espressif',
    '80:7D:3A':'Espressif','84:0D:8E':'Espressif','84:CC:A8':'Espressif',
    '84:F3:EB':'Espressif','8C:AA:B5':'Espressif','8C:CE:4E':'Espressif',
    '90:97:D5':'Espressif','94:3C:C6':'Espressif','94:B5:55':'Espressif',
    '94:B9:7E':'Espressif','98:CD:AC':'Espressif','98:F4:AB':'Espressif',
    'A0:20:A6':'Espressif','A4:7B:9D':'Espressif','A4:CF:12':'Espressif',
    'AC:67:B2':'Espressif','B4:E6:2D':'Espressif','B4:E6:2E':'Espressif',
    'BC:DD:C2':'Espressif','C4:4F:33':'Espressif','C4:5B:BE':'Espressif',
    'C8:2B:96':'Espressif','CC:50:E3':'Espressif','CC:DB:A7':'Espressif',
    'D4:D4:DA':'Espressif','D8:A0:1D':'Espressif','D8:BF:C0':'Espressif',
    'DC:4F:22':'Espressif','E0:98:06':'Espressif','E8:68:E7':'Espressif',
    'EC:FA:BC':'Espressif','F0:08:D1':'Espressif','F4:CF:A2':'Espressif',

    // Raspberry Pi
    '28:CD:C1':'Raspberry Pi','B8:27:EB':'Raspberry Pi','D8:3A:DD':'Raspberry Pi',
    'DC:A6:32':'Raspberry Pi','E4:5F:01':'Raspberry Pi',

    // OnePlus
    '94:65:2D':'OnePlus','C0:EE:FB':'OnePlus',

    // OPPO
    '2C:5B:E1':'OPPO','64:A2:F9':'OPPO','A0:8C:FD':'OPPO',

    // Realme
    'D8:38:FC':'Realme',

    // Motorola
    '00:04:56':'Motorola','00:08:0E':'Motorola','00:0C:E5':'Motorola',
    '00:0E:5C':'Motorola','00:11:80':'Motorola','00:14:04':'Motorola',
    '00:17:00':'Motorola','00:19:2C':'Motorola','00:1A:77':'Motorola',
    '00:1C:12':'Motorola','00:1E:5A':'Motorola','00:1F:7E':'Motorola',
    '00:21:80':'Motorola','00:23:68':'Motorola','00:24:A5':'Motorola',

    // Roku
    '84:EA:ED':'Roku','B0:A7:37':'Roku','DC:3A:5E':'Roku',

    // Nintendo
    '00:09:BF':'Nintendo','00:16:56':'Nintendo','00:17:AB':'Nintendo',
    '00:19:1D':'Nintendo','00:19:FD':'Nintendo','00:1A:E9':'Nintendo',
    '00:1B:EA':'Nintendo','00:1C:BE':'Nintendo','00:1D:BC':'Nintendo',
    '00:1E:35':'Nintendo','00:1F:32':'Nintendo','00:21:47':'Nintendo',
    '00:21:BD':'Nintendo','00:22:4C':'Nintendo','00:22:AA':'Nintendo',
    '00:23:31':'Nintendo','00:23:CC':'Nintendo','00:24:1E':'Nintendo',
    '00:24:44':'Nintendo','00:24:F3':'Nintendo','00:25:A0':'Nintendo',
    '00:26:59':'Nintendo','04:03:D6':'Nintendo','2C:10:C1':'Nintendo',
    '34:AF:2C':'Nintendo','40:D2:8A':'Nintendo','58:BD:A3':'Nintendo',
    '78:A2:A0':'Nintendo','7C:BB:8A':'Nintendo','8C:CD:E8':'Nintendo',
    '98:41:5C':'Nintendo','98:B6:E9':'Nintendo','A4:5C:27':'Nintendo',
    'A4:C0:E1':'Nintendo','B8:AE:6E':'Nintendo','CC:FB:65':'Nintendo',
    'D8:6B:F7':'Nintendo','DC:68:EB':'Nintendo','E0:0C:7F':'Nintendo',
    'E0:E7:51':'Nintendo','E8:4E:CE':'Nintendo',

    // Printer vendors
    '00:00:48':'HP Printer','00:01:E6':'HP','00:02:A5':'HP',
    '00:04:EA':'HP','00:08:02':'HP','00:0A:57':'HP',
    '00:0B:CD':'HP','00:0D:9D':'HP','00:0E:7F':'HP',
    '00:0F:20':'HP','00:0F:61':'HP','00:10:83':'HP',
    '00:00:74':'Ricoh','00:00:AA':'Xerox','00:00:01':'Xerox',
    '00:15:99':'Samsung','64:DB:A0':'Canon'
};

// Lookup function
window.lookupVendor = function(mac) {
    if (!mac || mac === 'UNKNOWN') return 'Desconocido';
    const prefix = mac.substring(0, 8).toUpperCase();
    return window.OUI_DB[prefix] || 'Desconocido';
};
