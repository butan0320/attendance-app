const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Database setup
const dbPath = path.join(__dirname, 'attendance.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

// Initialize database tables
function initializeDatabase() {
  db.serialize(() => {
    // Staff table
    db.run(`
      CREATE TABLE IF NOT EXISTS staff (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Attendance records table
    db.run(`
      CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        staff_id INTEGER NOT NULL,
        check_in_time DATETIME,
        check_out_time DATETIME,
        date DATE,
        FOREIGN KEY(staff_id) REFERENCES staff(id)
      )
    `);

    // Initialize with 10 default staff members if empty
    db.get('SELECT COUNT(*) as count FROM staff', (err, row) => {
      if (err) {
        console.error('Error checking staff count:', err);
        return;
      }
      if (row.count === 0) {
        const defaultStaff = [
          'スタッフ1',
          'スタッフ2',
          'スタッフ3',
          'スタッフ4',
          'スタッフ5',
          'スタッフ6',
          'スタッフ7',
          'スタッフ8',
          'スタッフ9',
          'スタッフ10'
        ];
        defaultStaff.forEach(name => {
          db.run('INSERT INTO staff (name) VALUES (?)', [name]);
        });
        console.log('Default staff members created');
      }
    });
  });
}

// API Routes

// Get all staff
app.get('/api/staff', (req, res) => {
  db.all('SELECT * FROM staff ORDER BY name', (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Update staff name
app.put('/api/staff/:id', (req, res) => {
  const { name } = req.body;
  db.run('UPDATE staff SET name = ? WHERE id = ?', [name, req.params.id], function(err) {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ id: req.params.id, name });
  });
});

// Check in
app.post('/api/attendance/check-in', (req, res) => {
  const { staff_id } = req.body;
  const today = new Date().toISOString().split('T')[0];
  const checkInTime = new Date().toISOString();

  // Check if already checked in today
  db.get(
    'SELECT * FROM attendance WHERE staff_id = ? AND date = ? AND check_in_time IS NOT NULL AND check_out_time IS NULL',
    [staff_id, today],
    (err, row) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      if (row) {
        res.status(400).json({ error: 'Already checked in today' });
        return;
      }
      // Insert new check-in record
      db.run(
        'INSERT INTO attendance (staff_id, check_in_time, date) VALUES (?, ?, ?)',
        [staff_id, checkInTime, today],
        function(err) {
          if (err) {
            res.status(500).json({ error: err.message });
            return;
          }
          res.json({ id: this.lastID, check_in_time: checkInTime });
        }
      );
    }
  );
});

// Check out
app.post('/api/attendance/check-out', (req, res) => {
  const { staff_id } = req.body;
  const today = new Date().toISOString().split('T')[0];
  const checkOutTime = new Date().toISOString();

  db.run(
    'UPDATE attendance SET check_out_time = ? WHERE staff_id = ? AND date = ? AND check_in_time IS NOT NULL AND check_out_time IS NULL',
    [checkOutTime, staff_id, today],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      if (this.changes === 0) {
        res.status(400).json({ error: 'No active check-in found' });
        return;
      }
      res.json({ check_out_time: checkOutTime });
    }
  );
});

// Get today's attendance for a staff member
app.get('/api/attendance/today/:staff_id', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  db.get(
    'SELECT * FROM attendance WHERE staff_id = ? AND date = ?',
    [req.params.staff_id, today],
    (err, row) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(row || { message: 'No records for today' });
    }
  );
});

// Get monthly attendance for a staff member
app.get('/api/attendance/monthly/:staff_id/:year/:month', (req, res) => {
  const { staff_id, year, month } = req.params;
  const monthStr = String(month).padStart(2, '0');
  const yearMonth = `${year}-${monthStr}`;

  db.all(
    `SELECT * FROM attendance WHERE staff_id = ? AND date LIKE ? ORDER BY date`,
    [staff_id, `${yearMonth}%`],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      // Calculate total working hours
      let totalMinutes = 0;
      rows.forEach(row => {
        if (row.check_in_time && row.check_out_time) {
          const checkIn = new Date(row.check_in_time);
          const checkOut = new Date(row.check_out_time);
          const minutes = (checkOut - checkIn) / (1000 * 60);
          totalMinutes += minutes;
        }
      });
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;
      res.json({ records: rows, totalHours: hours, totalMinutes: minutes });
    }
  );
});

// Get all staff attendance for today (for manager)
app.get('/api/attendance/all-today', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  db.all(
    `SELECT s.id, s.name, a.check_in_time, a.check_out_time FROM staff s
     LEFT JOIN attendance a ON s.id = a.staff_id AND a.date = ?
     ORDER BY s.name`,
    [today],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      const staffAttendance = rows.reduce((acc, row) => {
        const staffId = row.id;
        if (!acc[staffId]) {
          acc[staffId] = {
            id: row.id,
            name: row.name,
            records: []
          };
        }
        if (row.check_in_time || row.check_out_time) {
          acc[staffId].records.push({
            check_in_time: row.check_in_time,
            check_out_time: row.check_out_time
          });
        }
        return acc;
      }, {});
      res.json(Object.values(staffAttendance));
    }
  );
});

// Get all staff monthly attendance (for manager)
app.get('/api/attendance/all-monthly/:year/:month', (req, res) => {
  const { year, month } = req.params;
  const monthStr = String(month).padStart(2, '0');
  const yearMonth = `${year}-${monthStr}`;

  db.all(
    `SELECT s.id, s.name, a.check_in_time, a.check_out_time FROM staff s
     LEFT JOIN attendance a ON s.id = a.staff_id AND a.date LIKE ?
     ORDER BY s.name, a.date`,
    [`${yearMonth}%`],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      const staffAttendance = rows.reduce((acc, row) => {
        const staffId = row.id;
        if (!acc[staffId]) {
          acc[staffId] = {
            id: row.id,
            name: row.name,
            totalMinutes: 0,
            recordCount: 0
          };
        }
        if (row.check_in_time && row.check_out_time) {
          const checkIn = new Date(row.check_in_time);
          const checkOut = new Date(row.check_out_time);
          const minutes = (checkOut - checkIn) / (1000 * 60);
          acc[staffId].totalMinutes += minutes;
          acc[staffId].recordCount += 1;
        }
        return acc;
      }, {});
      const result = Object.values(staffAttendance).map(staff => ({
        ...staff,
        totalHours: Math.floor(staff.totalMinutes / 60),
        totalMinutes: staff.totalMinutes % 60
      }));
      res.json(result);
    }
  );
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
