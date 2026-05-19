const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

// Helper function to add 5.5 hours (IST offset)
function getISTDate(date = new Date()) {
  const istOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
  const istDate = new Date(date.getTime() + istOffset);
  return istDate;
}

function getISTDateString(date = new Date()) {
  const istDate = getISTDate(date);
  return istDate.toISOString().split('T')[0];
}

function getISTDateTime(date = new Date()) {
  const istDate = getISTDate(date);
  return istDate;
}

// Middleware - Updated CORS configuration
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:8080', 'http://localhost:8011', "http://192.168.0.186:8080", 'https://face-ml-frontend.onrender.com', 'http://localhost:3000', 'http://localhost:3010'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  credentials: true
}));

app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Create uploads directory
if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');
if (!fs.existsSync('./uploads/faces')) fs.mkdirSync('./uploads/faces');

// MySQL Connection Pool
const pool = mysql.createPool({
  host: '193.203.184.152',
  user: 'u816304761_my_task',
  password: 'K*@*YZRVsgsSL3A',
  database: 'u816304761_my_task',
  port: 3306,
  connectionLimit: 10,
  waitForConnections: true,
  enableKeepAlive: true
});

// Test connection and initialize database
async function initializeSystem() {
  let connection;
  try {
    console.log('🔄 Connecting to MySQL...');
    connection = await pool.getConnection();
    console.log('✅ MySQL Connected Successfully!');
    
    // Create tables
    await connection.query(`
      CREATE TABLE IF NOT EXISTS tsk_admins (
        id INT PRIMARY KEY AUTO_INCREMENT,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Table tsk_admins ready');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS tsk_employees (
        id INT PRIMARY KEY AUTO_INCREMENT,
        employee_id VARCHAR(50) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        position VARCHAR(100) NOT NULL,
        department VARCHAR(100) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        face_image VARCHAR(500),
        face_descriptor JSON,
        is_active BOOLEAN DEFAULT TRUE,
        registration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_employee_id (employee_id),
        INDEX idx_email (email)
      )
    `);
    console.log('✅ Table tsk_employees ready');

    // Attendance table - each scan is a new record
    await connection.query(`
      CREATE TABLE IF NOT EXISTS tsk_attendance (
        id INT PRIMARY KEY AUTO_INCREMENT,
        employee_id VARCHAR(50) NOT NULL,
        employee_name VARCHAR(255) NOT NULL,
        scan_date DATE NOT NULL,
        scan_time DATETIME NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_employee_id (employee_id),
        INDEX idx_scan_date (scan_date),
        INDEX idx_employee_date (employee_id, scan_date)
      )
    `);
    console.log('✅ Table tsk_attendance ready');

    // Create default admin if not exists
    const [admins] = await connection.query('SELECT * FROM tsk_admins WHERE email = ?', ['admin@modulelabs.in']);
    
    if (admins.length === 0) {
      const hashedPassword = await bcrypt.hash('Admin@123', 10);
      await connection.query('INSERT INTO tsk_admins (email, password) VALUES (?, ?)', ['admin@modulelabs.in', hashedPassword]);
      console.log('✅ Default admin created: admin@modulelabs.in / Admin@123');
    }

    connection.release();
    console.log('🎉 System ready!\n');
    return true;
  } catch (error) {
    console.error('❌ Database Error:', error.message);
    if (connection) connection.release();
    return false;
  }
}

// Multer setup for face images
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, './uploads/faces'),
  filename: (req, file, cb) => {
    const employeeId = req.params.employeeId || req.body.employeeId;
    cb(null, `${employeeId}_${Date.now()}.jpg`);
  }
});

const upload = multer({ 
  storage, 
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images allowed'), false);
  }
});

// Auth middleware
const auth = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, 'modulelabs_secret_2024');
    req.adminId = decoded.id;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ============ API ROUTES ============

// Admin Login
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const [admins] = await pool.query('SELECT * FROM tsk_admins WHERE email = ?', [email]);
    
    if (admins.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    
    const valid = await bcrypt.compare(password, admins[0].password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    
    const token = jwt.sign({ id: admins[0].id, email }, 'modulelabs_secret_2024', { expiresIn: '24h' });
    res.json({ token, admin: { email } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test endpoint
app.get('/api/test', async (req, res) => {
  try {
    const [result] = await pool.query('SELECT NOW() as time, DATABASE() as db, USER() as user');
    res.json({ success: true, message: 'API Working!', info: result[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all employees
app.get('/api/employees', auth, async (req, res) => {
  try {
    const [employees] = await pool.query('SELECT * FROM tsk_employees WHERE is_active = 1 ORDER BY created_at DESC');
    res.json(employees);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add employee
app.post('/api/employees', auth, async (req, res) => {
  try {
    const { employeeId, name, email, position, department, phone } = req.body;
    
    const [existing] = await pool.query('SELECT * FROM tsk_employees WHERE employee_id = ? OR email = ?', [employeeId, email]);
    if (existing.length > 0) return res.status(400).json({ error: 'Employee ID or email exists' });
    
    const [result] = await pool.query(
      'INSERT INTO tsk_employees (employee_id, name, email, position, department, phone) VALUES (?, ?, ?, ?, ?, ?)',
      [employeeId, name, email, position, department, phone]
    );
    
    const [newEmp] = await pool.query('SELECT * FROM tsk_employees WHERE id = ?', [result.insertId]);
    res.status(201).json(newEmp[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update employee
app.put('/api/employees/:id', auth, async (req, res) => {
  try {
    const { name, position, department, phone } = req.body;
    await pool.query('UPDATE tsk_employees SET name=?, position=?, department=?, phone=? WHERE id=?', [name, position, department, phone, req.params.id]);
    const [updated] = await pool.query('SELECT * FROM tsk_employees WHERE id = ?', [req.params.id]);
    res.json(updated[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete employee
app.delete('/api/employees/:id', auth, async (req, res) => {
  try {
    await pool.query('UPDATE tsk_employees SET is_active = 0 WHERE id = ?', [req.params.id]);
    res.json({ message: 'Employee deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Register face
app.post('/api/employees/:id/register-face', auth, upload.single('faceImage'), async (req, res) => {
  try {
    const { faceDescriptor } = req.body;
    if (!req.file) return res.status(400).json({ error: 'Face image required' });
    if (!faceDescriptor) return res.status(400).json({ error: 'Face descriptor required' });
    
    await pool.query('UPDATE tsk_employees SET face_image = ?, face_descriptor = ? WHERE id = ?', [
      `/uploads/faces/${req.file.filename}`,
      faceDescriptor,
      req.params.id
    ]);
    
    res.json({ message: 'Face registered successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Face recognition for attendance - Each scan creates a new record
app.post('/api/attendance/recognize', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { faceDescriptor } = req.body;
    if (!faceDescriptor) return res.status(400).json({ error: 'Face descriptor required' });
    
    const [employees] = await connection.query('SELECT * FROM tsk_employees WHERE face_descriptor IS NOT NULL AND is_active = 1');
    
    let matched = null;
    let bestScore = 0;
    
    for (const emp of employees) {
      const desc = JSON.parse(emp.face_descriptor);
      let score = 0;
      for (let i = 0; i < desc.length; i++) score += desc[i] * faceDescriptor[i];
      if (score > 0.6 && score > bestScore) {
        bestScore = score;
        matched = emp;
      }
    }
    
    if (!matched) return res.status(404).json({ error: 'Face not recognized' });

    // Get current time in IST (UTC+5:30)
    const istNow = getISTDateTime();
    const istToday = getISTDateString();
    
    console.log(`IST Time: ${istNow}`);
    console.log(`IST Date: ${istToday}`);
    
    // Insert new attendance record for each scan with IST time
    await connection.query(
      'INSERT INTO tsk_attendance (employee_id, employee_name, scan_date, scan_time) VALUES (?, ?, ?, ?)',
      [matched.employee_id, matched.name, istToday, istNow]
    );
    
    // const now = new Date();
    // const today = now.toISOString().split('T')[0];
    
    // // Insert new attendance record for each scan
    // await connection.query(
    //   'INSERT INTO tsk_attendance (employee_id, employee_name, scan_date, scan_time) VALUES (?, ?, ?, ?)',
    //   [matched.employee_id, matched.name, today, now]
    // );
    
    // Get today's scan count for this employee
    const [scanCount] = await connection.query(
      'SELECT COUNT(*) as count FROM tsk_attendance WHERE employee_id = ? AND scan_date = ?',
      [matched.employee_id, today]
    );
    
    // res.json({ 
    //   success: true,
    //   employee: matched,
    //   scanTime: now,
    //   scanCount: scanCount[0].count,
    //   message: `✅ Hello ${matched.name}! Scan #${scanCount[0].count} recorded at ${now.toLocaleTimeString()}`
    // });
    res.json({ 
      success: true,
      employee: matched,
      scanTime: istNow,
      scanDate: istToday,
      scanCount: scanCount[0].count,
      timezone: 'IST (UTC+5:30)',
      message: `✅ Hello ${matched.name}! Scan #${scanCount[0].count} recorded at ${istNow.toLocaleTimeString()} (IST)`
    });
    
  } catch (error) {
    console.error('Recognition error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Get attendance records - All scans
app.get('/api/attendance', auth, async (req, res) => {
  try {
    const { startDate, endDate, employeeId } = req.query;
    let query = `
      SELECT 
        a.id,
        a.employee_id,
        a.employee_name,
        a.scan_date,
        a.scan_time,
        DATE_FORMAT(a.scan_time, '%H:%i:%s') as scan_time_only
      FROM tsk_attendance a
      WHERE 1=1
    `;
    const params = [];
    
    if (startDate && endDate) {
      query += ' AND a.scan_date BETWEEN ? AND ?';
      params.push(startDate, endDate);
    }
    if (employeeId) {
      query += ' AND a.employee_id = ?';
      params.push(employeeId);
    }
    
    query += ' ORDER BY a.scan_date DESC, a.scan_time DESC';
    
    const [records] = await pool.query(query, params);
    res.json(records);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get daily summary - Group by date to show who was present
app.get('/api/attendance/daily-summary', auth, async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];
    
    const [summary] = await pool.query(`
      SELECT 
        employee_id,
        employee_name,
        COUNT(*) as scan_count,
        MIN(scan_time) as first_scan,
        MAX(scan_time) as last_scan
      FROM tsk_attendance
      WHERE scan_date = ?
      GROUP BY employee_id, employee_name
      ORDER BY first_scan DESC
    `, [targetDate]);
    
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Dashboard stats
app.get('/api/dashboard/stats', auth, async (req, res) => {
  try {
    const [totalEmp] = await pool.query('SELECT COUNT(*) as total FROM tsk_employees WHERE is_active = 1');
    const [faceReg] = await pool.query('SELECT COUNT(*) as registered FROM tsk_employees WHERE face_descriptor IS NOT NULL');
    const today = new Date().toISOString().split('T')[0];
    
    // Today's attendance (employees who have at least one scan today)
    const [todayAtt] = await pool.query(
      'SELECT COUNT(DISTINCT employee_id) as count FROM tsk_attendance WHERE scan_date = ?',
      [today]
    );
    
    // Today's total scans
    const [totalScans] = await pool.query(
      'SELECT COUNT(*) as count FROM tsk_attendance WHERE scan_date = ?',
      [today]
    );
    
    // Last 7 days attendance trend (unique employees per day)
    const lastWeek = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const [countResult] = await pool.query(
        'SELECT COUNT(DISTINCT employee_id) as count FROM tsk_attendance WHERE scan_date = ?',
        [dateStr]
      );
      lastWeek.push({ date: dateStr, count: countResult[0].count });
    }
    
    res.json({
      totalEmployees: totalEmp[0].total,
      employeesWithFace: faceReg[0].registered,
      todayAttendance: todayAtt[0].count,
      todayTotalScans: totalScans[0].count,
      lastWeek: lastWeek
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get employee scan history
app.get('/api/attendance/employee/:employeeId', auth, async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { startDate, endDate } = req.query;
    
    let query = `
      SELECT 
        id,
        scan_date,
        scan_time,
        DATE_FORMAT(scan_time, '%H:%i:%s') as scan_time_only
      FROM tsk_attendance
      WHERE employee_id = ?
    `;
    const params = [employeeId];
    
    if (startDate && endDate) {
      query += ' AND scan_date BETWEEN ? AND ?';
      params.push(startDate, endDate);
    }
    
    query += ' ORDER BY scan_date DESC, scan_time DESC';
    
    const [records] = await pool.query(query, params);
    res.json(records);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  console.log('\n========================================');
  console.log('🚀 ModuleLabs Attendance System Backend');
  console.log('========================================');
  console.log(`📍 Server: http://localhost:${PORT}`);
  console.log(`📁 Uploads: ${path.join(__dirname, 'uploads')}`);
  console.log('========================================');
  console.log('✅ CORS Enabled for:');
  console.log('   - http://localhost:5173');
  console.log('   - http://localhost:8080');
  console.log('   - http://localhost:8011');
  console.log('   - http://192.168.0.186:8080');
  console.log('   - https://uat-photoassets.outlookindia.com');
  console.log('   - http://localhost:3000');
  console.log('   - http://localhost:3010');
  console.log('========================================\n');
  
  const initialized = await initializeSystem();
  
  if (initialized) {
    console.log('✨ Backend Ready!');
    console.log('🔐 Admin Login: POST http://localhost:5000/api/admin/login');
    console.log('📝 Test API: GET http://localhost:5000/api/test');
    console.log('👤 Face Recognition: POST http://localhost:5000/api/attendance/recognize\n');
  } else {
    console.log('\n❌ Failed to connect to database. Please check your credentials.');
    process.exit(1);
  }
});