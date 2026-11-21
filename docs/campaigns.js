/*
 * 表單總覽頁（網站根目錄）列出的所有預購表單。
 * 新增活動時在這裡加一筆，最新的放最上面。
 *   path     活動資料夾（相對網站根目錄，結尾要有 /）
 *   image    封面圖（相對網站根目錄），建議 16:9
 *   opens    開始時間（選填，未到時間顯示「即將開放」）
 *   deadline 截止時間，需與該活動 config.js 一致
 */
window.CAMPAIGNS = [
  {
    path: '2026Birthday/',
    title: '多帕 2026 生日周邊',
    desc: '厚壓克力磚、大滑鼠墊、親簽明信片',
    image: '2026Birthday/img/key-visual.jpg',
    deadline: '2026-11-22T23:59:59+08:00'
  }
];
