const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads')); 

// Create uploads directory
if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');
if (!fs.existsSync('./uploads/faces')) fs.mkdirSync('./uploads/faces');

// MySQL Connection Pool - Using the exact working format
const pool = mysql.createPool({
  host: '193.203.184.152',
  user: 'u816304761_my_task',
  password: 'K*@*YZRVsgsSL3A',  // Password with special chars as is
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

    await connection.query(`
      CREATE TABLE IF NOT EXISTS tsk_attendance (
        id INT PRIMARY KEY AUTO_INCREMENT,
        employee_id VARCHAR(50) NOT NULL,
        employee_name VARCHAR(255) NOT NULL,
        date DATE NOT NULL,
        check_in DATETIME,
        check_out DATETIME,
        status ENUM('present', 'absent', 'late') DEFAULT 'present',
        working_hours DECIMAL(5,2) DEFAULT 0,
        check_in_image VARCHAR(500),
        check_out_image VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_employee_id (employee_id),
        INDEX idx_date (date),
        UNIQUE KEY unique_attendance (employee_id, date)
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

// Face recognition for attendance
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
    
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const isLate = now.getHours() > 10;
    
    const [existing] = await connection.query('SELECT * FROM tsk_attendance WHERE employee_id = ? AND date = ?', [matched.employee_id, today]);
    
    if (existing.length === 0) {
      // Check-in
      await connection.query(
        'INSERT INTO tsk_attendance (employee_id, employee_name, date, check_in, status) VALUES (?, ?, ?, ?, ?)',
        [matched.employee_id, matched.name, today, now, isLate ? 'late' : 'present']
      );
      res.json({ action: 'check-in', employee: matched, time: now, message: `Welcome ${matched.name}!` });
    } else if (!existing[0].check_out) {
      // Check-out
      const hours = (now - new Date(existing[0].check_in)) / (1000 * 60 * 60);
      await connection.query('UPDATE tsk_attendance SET check_out = ?, working_hours = ? WHERE id = ?', [now, hours, existing[0].id]);
      res.json({ action: 'check-out', employee: matched, time: now, workingHours: hours.toFixed(1), message: `Goodbye ${matched.name}!` });
    } else {
      res.status(400).json({ error: 'Already checked out today' });
    }
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Get attendance records
app.get('/api/attendance', auth, async (req, res) => {
  try {
    const [records] = await pool.query('SELECT * FROM tsk_attendance ORDER BY date DESC, check_in DESC');
    res.json(records);
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
    const [todayAtt] = await pool.query('SELECT COUNT(*) as count FROM tsk_attendance WHERE date = ?', [today]);
    
    res.json({
      totalEmployees: totalEmp[0].total,
      employeesWithFace: faceReg[0].registered,
      todayAttendance: todayAtt[0].count,
      presentToday: 0,
      lateToday: 0,
      lastWeek: []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server
const PORT = 5000;
app.listen(PORT, async () => {
  console.log('\n========================================');
  console.log('🚀 ModuleLabs Attendance System Backend');
  console.log('========================================');
  console.log(`📍 Server: http://localhost:${PORT}`);
  console.log(`📁 Uploads: ${path.join(__dirname, 'uploads')}`);
  console.log('========================================\n');
  
  const initialized = await initializeSystem();
  
  if (initialized) {
    console.log('\n✨ Backend Ready!');
    console.log('🔐 Admin Login: POST http://localhost:5000/api/admin/login');
    console.log('📝 Test API: GET http://localhost:5000/api/test\n');
  } else {
    console.log('\n❌ Failed to connect to database. Please check your credentials.');
    process.exit(1);
  }
});