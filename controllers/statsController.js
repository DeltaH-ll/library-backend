const db = require("../db");

exports.overview = async (req, res) => {
  try {
    const [[bookStats]] = await db.query(
      `SELECT 
          COUNT(*) AS totalBooks,
          COALESCE(SUM(available_count), 0) AS availableBooks,
          COALESCE(SUM(total_count), 0) AS totalCopies
       FROM books`
    );

    const [[borrowedStats]] = await db.query(
      "SELECT COUNT(*) AS borrowed FROM borrow WHERE status = '借出'"
    );

    const [[userStats]] = await db.query(
      "SELECT COUNT(*) AS totalUsers FROM users"
    );

    const [trendRows] = await db.query(
      `SELECT DATE(borrow_date) AS day, COUNT(*) AS total
       FROM borrow
       WHERE borrow_date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
       GROUP BY day
       ORDER BY day ASC`
    );

    const totalBooks = Number(bookStats?.totalBooks || 0);
    const totalCopies = Number(bookStats?.totalCopies || 0);
    const borrowed = Number(borrowedStats?.borrowed || 0);
    const totalUsers = Number(userStats?.totalUsers || 0);

    const data = {
      books: totalBooks,
      users: totalUsers,
      borrowed,
      inLibrary: Math.max(0, totalCopies - borrowed),
      borrowRate:
        totalCopies > 0
          ? Number(((borrowed / totalCopies) * 100).toFixed(1))
          : 0,
    };

    const trendMap = trendRows.reduce((acc, row) => {
      acc[row.day] = row.total;
      return acc;
    }, {});
    const normalizedTrend = [];
    const today = new Date();
    for (let i = 6; i >= 0; i -= 1) {
      const day = new Date(today);
      day.setDate(today.getDate() - i);
      const dayStr = day.toISOString().slice(0, 10);
      normalizedTrend.push({
        day: dayStr,
        total: trendMap[dayStr] || 0,
      });
    }

    res.json({
      success: true,
      data,
      trend: normalizedTrend,
    });
  } catch (error) {
    console.error("获取统计数据失败:", error);
    res.status(500).json({ success: false, error: "获取统计数据失败" });
  }
};

