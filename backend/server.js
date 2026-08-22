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

    // Break records table
    db.run(`
      CREATE TABLE IF NOT EXISTS break_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        staff_id INTEGER NOT NULL,
        attendance_id INTEGER NOT NULL,
        break_start_time DATETIME,
        break_end_time DATETIME,
        date DATE,
        FOREIGN KEY(staff_id) REFERENCES staff(id),
        FOREIGN KEY(attendance_id) REFERENCES attendance(id)
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

// Break start
app.post('/api/attendance/break-start', (req, res) => {
  const { staff_id } = req.body;
  const today = new Date().toISOString().split('T')[0];
  const breakStartTime = new Date().toISOString();

  // Get today's attendance record
  db.get(
    'SELECT id FROM attendance WHERE staff_id = ? AND date = ? AND check_in_time IS NOT NULL AND check_out_time IS NULL',
    [staff_id, today],
    (err, row) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      if (!row) {
        res.status(400).json({ error: 'No active check-in found' });
        return;
      }

      // Check if already on break
      db.get(
        'SELECT * FROM break_records WHERE staff_id = ? AND date = ? AND break_start_time IS NOT NULL AND break_end_time IS NULL',
        [staff_id, today],
        (err, breakRow) => {
          if (err) {
            res.status(500).json({ error: err.message });
            return;
          }
          if (breakRow) {
            res.status(400).json({ error: 'Already on break' });
            return;
          }

          // Insert break start record
          db.run(
            'INSERT INTO break_records (staff_id, attendance_id, break_start_time, date) VALUES (?, ?, ?, ?)',
            [staff_id, row.id, breakStartTime, today],
            function(err) {
              if (err) {
                res.status(500).json({ error: err.message });
                return;
              }
              res.json({ id: this.lastID, break_start_time: breakStartTime });
            }
          );
        }
      );
    }
  );
});

// Break end
app.post('/api/attendance/break-end', (req, res) => {
  const { staff_id } = req.body;
  const today = new Date().toISOString().split('T')[0];
  const breakEndTime = new Date().toISOString();

  db.run(
    'UPDATE break_records SET break_end_time = ? WHERE staff_id = ? AND date = ? AND break_start_time IS NOT NULL AND break_end_time IS NULL',
    [breakEndTime, staff_id, today],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      if (this.changes === 0) {
        res.status(400).json({ error: 'No active break found' });
        return;
      }
      res.json({ break_end_time: breakEndTime });
    }
  );
});

// Get today's attendance and break records for a staff member
app.get('/api/attendance/today/:staff_id', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  db.get(
    'SELECT * FROM attendance WHERE staff_id = ? AND date = ?',
    [req.params.staff_id, today],
    (err, attendanceRow) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }

      if (!attendanceRow) {
        res.json({ message: 'No records for today' });
        return;
      }

      // Get break records for today
      db.all(
        'SELECT * FROM break_records WHERE staff_id = ? AND date = ? ORDER BY break_start_time',
        [req.params.staff_id, today],
        (err, breakRows) => {
          if (err) {
            res.status(500).json({ error: err.message });
            return;
          }

          // Calculate total break time
          let totalBreakMinutes = 0;
          breakRows.forEach(breakRecord => {
            if (breakRecord.break_start_time && breakRecord.break_end_time) {
              const breakStart = new Date(breakRecord.break_start_time);
              const breakEnd = new Date(breakRecord.break_end_time);
              const minutes = (breakEnd - breakStart) / (1000 * 60);
              totalBreakMinutes += minutes;
            }
          });

          // Calculate actual working hours (excluding breaks)
          let actualWorkingMinutes = 0;
          if (attendanceRow.check_in_time && attendanceRow.check_out_time) {
            const checkIn = new Date(attendanceRow.check_in_time);
            const checkOut = new Date(attendanceRow.check_out_time);
            const totalMinutes = (checkOut - checkIn) / (1000 * 60);
            actualWorkingMinutes = totalMinutes - totalBreakMinutes;
          }

          res.json({
            attendance: attendanceRow,
            breaks: breakRows,
            totalBreakMinutes: Math.round(totalBreakMinutes),
            totalBreakHours: Math.floor(totalBreakMinutes / 60),
            actualWorkingMinutes: Math.round(actualWorkingMinutes),
            actualWorkingHours: Math.floor(actualWorkingMinutes / 60)
          });
        }
      );
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

      // Get all break records for the month
      db.all(
        `SELECT * FROM break_records WHERE staff_id = ? AND date LIKE ?`,
        [staff_id, `${yearMonth}%`],
        (err, breakRows) => {
          if (err) {
            res.status(500).json({ error: err.message });
            return;
          }

          // Calculate total working hours and break time
          let totalWorkingMinutes = 0;
          let totalBreakMinutes = 0;

          rows.forEach(row => {
            if (row.check_in_time && row.check_out_time) {
              const checkIn = new Date(row.check_in_time);
              const checkOut = new Date(row.check_out_time);
              const minutes = (checkOut - checkIn) / (1000 * 60);
              totalWorkingMinutes += minutes;
            }
          });

          breakRows.forEach(breakRecord => {
            if (breakRecord.break_start_time && breakRecord.break_end_time) {
              const breakStart = new Date(breakRecord.break_start_time);
              const breakEnd = new Date(breakRecord.break_end_time);
              const minutes = (breakEnd - breakStart) / (1000 * 60);
              totalBreakMinutes += minutes;
            }
          });

          const actualWorkingMinutes = totalWorkingMinutes - totalBreakMinutes;

          res.json({
            records: rows,
            breakRecords: breakRows,
            totalHours: Math.floor(totalWorkingMinutes / 60),
            totalMinutes: totalWorkingMinutes % 60,
            totalBreakHours: Math.floor(totalBreakMinutes / 60),
            totalBreakMinutes: totalBreakMinutes % 60,
            actualWorkingHours: Math.floor(actualWorkingMinutes / 60),
            actualWorkingMinutes: actualWorkingMinutes % 60
          });
        }
      );
    }
  );
});

// Get all staff attendance for today (for manager)
app.get('/api/attendance/all-today', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  db.all(
    `SELECT s.id, s.name, a.id as attendance_id, a.check_in_time, a.check_out_time FROM staff s
     LEFT JOIN attendance a ON s.id = a.staff_id AND a.date = ?
     ORDER BY s.name`,
    [today],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }

      // Fetch break records for all staff
      db.all(
        `SELECT * FROM break_records WHERE date = ?`,
        [today],
        (err, breakRows) => {
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
                records: [],
                breaks: []
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

          // Add break records
          breakRows.forEach(breakRecord => {
            const staffId = breakRecord.staff_id;
            if (staffAttendance[staffId]) {
              staffAttendance[staffId].breaks.push({
                break_start_time: breakRecord.break_start_time,
                break_end_time: breakRecord.break_end_time
              });
            }
          });

          res.json(Object.values(staffAttendance));
        }
      );
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

      // Get all break records for the month
      db.all(
        `SELECT * FROM break_records WHERE date LIKE ?`,
        [`${yearMonth}%`],
        (err, breakRows) => {
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
                totalBreakMinutes: 0,
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

          // Calculate break times
          breakRows.forEach(breakRecord => {
            const staffId = breakRecord.staff_id;
            if (staffAttendance[staffId]) {
              if (breakRecord.break_start_time && breakRecord.break_end_time) {
                const breakStart = new Date(breakRecord.break_start_time);
                const breakEnd = new Date(breakRecord.break_end_time);
                const minutes = (breakEnd - breakStart) / (1000 * 60);
                staffAttendance[staffId].totalBreakMinutes += minutes;
              }
            }
          });

          const result = Object.values(staffAttendance).map(staff => {
            const actualWorkingMinutes = staff.totalMinutes - staff.totalBreakMinutes;
            return {
              ...staff,
              totalHours: Math.floor(staff.totalMinutes / 60),
              totalMinutes: staff.totalMinutes % 60,
              totalBreakHours: Math.floor(staff.totalBreakMinutes / 60),
              totalBreakMinutes: staff.totalBreakMinutes % 60,
              actualWorkingHours: Math.floor(actualWorkingMinutes / 60),
              actualWorkingMinutes: actualWorkingMinutes % 60
            };
          });
          res.json(result);
        }
      );
    }
  );
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
