const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));

// Create uploads directory if not exists
if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads');
}
if (!fs.existsSync('./uploads/faces')) {
  fs.mkdirSync('./uploads/faces');
}

// Multer configuration for face image upload - FIXED
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, './uploads/faces');
  },
  filename: function(req, file, cb) {
    const employeeId = req.params.employeeId || req.body.employeeId;
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${employeeId}_${uniqueSuffix}.jpg`);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only images are allowed'), false);
  }
};

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: fileFilter
});

// Database connection - FIXED (removed deprecated options)
mongoose.connect('mongodb://localhost:27017/modulelabs_attendance')
.then(() => console.log('MongoDB connected successfully'))
.catch(err => console.log('MongoDB connection error:', err));

// Models
const EmployeeSchema = new mongoose.Schema({
  employeeId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  position: { type: String, required: true },
  department: { type: String, required: true },
  phone: { type: String, required: true },
  faceImage: { type: String, default: null },
  faceDescriptor: { type: Array, default: null },
  isActive: { type: Boolean, default: true },
  registrationDate: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now }
});

const AttendanceSchema = new mongoose.Schema({
  employeeId: { type: String, required: true },
  employeeName: { type: String, required: true },
  date: { type: String, required: true },
  checkIn: { type: Date },
  checkOut: { type: Date },
  status: { type: String, enum: ['present', 'absent', 'late'], default: 'present' },
  workingHours: { type: Number, default: 0 },
  checkInImage: { type: String },
  checkOutImage: { type: String }
});

const AdminSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }
});

const Employee = mongoose.model('Employee', EmployeeSchema);
const Attendance = mongoose.model('Attendance', AttendanceSchema);
const Admin = mongoose.model('Admin', AdminSchema);

// Initialize default admin
const initializeAdmin = async () => {
  try {
    const adminExists = await Admin.findOne({ email: 'admin@modulelabs.in' });
    if (!adminExists) {
      const hashedPassword = await bcrypt.hash('Admin@123', 10);
      await Admin.create({
        email: 'admin@modulelabs.in',
        password: hashedPassword
      });
      console.log('Default admin created successfully');
      console.log('Admin Email: admin@modulelabs.in');
      console.log('Admin Password: Admin@123');
    } else {
      console.log('Admin already exists');
    }
  } catch (error) {
    console.error('Error initializing admin:', error);
  }
};

// Authentication Middleware
const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'modulelabs_secret_key');
    req.adminId = decoded.adminId;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Routes

// Admin Login
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const admin = await Admin.findOne({ email });
    
    if (!admin) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const isValidPassword = await bcrypt.compare(password, admin.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { adminId: admin._id, email: admin.email },
      process.env.JWT_SECRET || 'modulelabs_secret_key',
      { expiresIn: '24h' }
    );
    
    res.json({ token, admin: { email: admin.email } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test route
app.get('/api/test', (req, res) => {
  res.json({ message: 'API is working!' });
});

// Employee CRUD Operations
app.get('/api/employees', authMiddleware, async (req, res) => {
  try {
    const employees = await Employee.find({ isActive: true }).sort({ createdAt: -1 });
    res.json(employees);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/employees', authMiddleware, async (req, res) => {
  try {
    const { employeeId, name, email, position, department, phone } = req.body;
    
    const existingEmployee = await Employee.findOne({ $or: [{ employeeId }, { email }] });
    if (existingEmployee) {
      return res.status(400).json({ error: 'Employee ID or email already exists' });
    }
    
    const employee = new Employee({
      employeeId,
      name,
      email,
      position,
      department,
      phone
    });
    
    await employee.save();
    res.status(201).json(employee);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/employees/:id', authMiddleware, async (req, res) => {
  try {
    const { name, position, department, phone } = req.body;
    const employee = await Employee.findByIdAndUpdate(
      req.params.id,
      { name, position, department, phone },
      { new: true }
    );
    res.json(employee);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/employees/:id', authMiddleware, async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    // Delete face image if exists
    if (employee.faceImage) {
      const imagePath = path.join(__dirname, employee.faceImage);
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    }
    
    await Employee.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: 'Employee deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Face Registration with Image Upload - FIXED
app.post('/api/employees/:id/register-face', authMiddleware, upload.single('faceImage'), async (req, res) => {
  try {
    const { faceDescriptor } = req.body;
    const employeeId = req.params.id;
    
    console.log('Face registration request received for employee:', employeeId);
    console.log('File:', req.file);
    console.log('Face descriptor length:', faceDescriptor ? JSON.parse(faceDescriptor).length : 'null');
    
    if (!req.file) {
      return res.status(400).json({ error: 'Face image is required' });
    }
    
    if (!faceDescriptor) {
      return res.status(400).json({ error: 'Face descriptor is required' });
    }
    
    const employee = await Employee.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    // Delete old face image if exists
    if (employee.faceImage) {
      const oldImagePath = path.join(__dirname, employee.faceImage);
      if (fs.existsSync(oldImagePath)) {
        fs.unlinkSync(oldImagePath);
      }
    }
    
    employee.faceImage = `/uploads/faces/${req.file.filename}`;
    employee.faceDescriptor = JSON.parse(faceDescriptor);
    await employee.save();
    
    console.log('Face registered successfully for employee:', employee.name);
    
    res.json({ 
      message: 'Face registered successfully',
      faceImage: employee.faceImage
    });
  } catch (error) {
    console.error('Face registration error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get employee face image
app.get('/api/employees/:id/face', authMiddleware, async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee || !employee.faceImage) {
      return res.status(404).json({ error: 'Face image not found' });
    }
    res.json({ faceImage: employee.faceImage });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Face Recognition for Attendance
app.post('/api/attendance/recognize', async (req, res) => {
  try {
    const { faceDescriptor } = req.body;
    
    if (!faceDescriptor) {
      return res.status(400).json({ error: 'Face descriptor is required' });
    }
    
    // Find employee with matching face descriptor
    const employees = await Employee.find({ faceDescriptor: { $ne: null }, isActive: true });
    
    if (employees.length === 0) {
      return res.status(404).json({ error: 'No registered faces found in system' });
    }
    
    let matchedEmployee = null;
    let bestMatchScore = 0;
    
    for (const employee of employees) {
      const similarity = calculateCosineSimilarity(faceDescriptor, employee.faceDescriptor);
      console.log(`Similarity for ${employee.name}: ${similarity}`);
      if (similarity > 0.6 && similarity > bestMatchScore) { // Threshold for face match
        bestMatchScore = similarity;
        matchedEmployee = employee;
      }
    }
    
    if (!matchedEmployee) {
      return res.status(404).json({ error: 'Face not recognized. Please ensure you have registered your face.' });
    }
    
    const today = new Date().toISOString().split('T')[0];
    let attendance = await Attendance.findOne({
      employeeId: matchedEmployee.employeeId,
      date: today
    });
    
    const now = new Date();
    const currentHour = now.getHours();
    const isLate = currentHour > 10; // Late after 10 AM
    
    if (!attendance) {
      // Check-in
      attendance = new Attendance({
        employeeId: matchedEmployee.employeeId,
        employeeName: matchedEmployee.name,
        date: today,
        checkIn: now,
        status: isLate ? 'late' : 'present',
        checkInImage: matchedEmployee.faceImage
      });
      await attendance.save();
      res.json({
        action: 'check-in',
        employee: matchedEmployee,
        time: now,
        status: isLate ? 'late' : 'present',
        message: `Welcome ${matchedEmployee.name}! Checked in at ${now.toLocaleTimeString()}`
      });
    } else if (!attendance.checkOut) {
      // Check-out
      attendance.checkOut = now;
      attendance.checkOutImage = matchedEmployee.faceImage;
      const workingHours = (now - new Date(attendance.checkIn)) / (1000 * 60 * 60);
      attendance.workingHours = Math.round(workingHours * 10) / 10;
      await attendance.save();
      res.json({
        action: 'check-out',
        employee: matchedEmployee,
        time: now,
        workingHours: attendance.workingHours,
        message: `Goodbye ${matchedEmployee.name}! Checked out at ${now.toLocaleTimeString()}. Total hours: ${attendance.workingHours}`
      });
    } else {
      res.status(400).json({ error: 'Already checked out for today' });
    }
  } catch (error) {
    console.error('Face recognition error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get Attendance Records
app.get('/api/attendance', authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate, employeeId } = req.query;
    let query = {};
    
    if (startDate && endDate) {
      query.date = { $gte: startDate, $lte: endDate };
    }
    if (employeeId) {
      query.employeeId = employeeId;
    }
    
    const records = await Attendance.find(query).sort({ date: -1, checkIn: -1 });
    res.json(records);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Dashboard Stats
app.get('/api/dashboard/stats', authMiddleware, async (req, res) => {
  try {
    const totalEmployees = await Employee.countDocuments({ isActive: true });
    const employeesWithFace = await Employee.countDocuments({ faceDescriptor: { $ne: null }, isActive: true });
    const today = new Date().toISOString().split('T')[0];
    const todayAttendance = await Attendance.countDocuments({ date: today });
    const presentToday = await Attendance.countDocuments({ date: today, status: 'present' });
    const lateToday = await Attendance.countDocuments({ date: today, status: 'late' });
    
    // Last 7 days attendance
    const lastWeek = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const count = await Attendance.countDocuments({ date: dateStr });
      lastWeek.push({ date: dateStr, count });
    }
    
    res.json({
      totalEmployees,
      employeesWithFace,
      todayAttendance,
      presentToday,
      lateToday,
      lastWeek
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function calculateCosineSimilarity(desc1, desc2) {
  if (!desc1 || !desc2 || desc1.length !== desc2.length) {
    return 0;
  }
  
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  
  for (let i = 0; i < desc1.length; i++) {
    dotProduct += desc1[i] * desc2[i];
    norm1 += desc1[i] * desc1[i];
    norm2 += desc2[i] * desc2[i];
  }
  
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Uploads directory: ${path.join(__dirname, 'uploads')}`);
  await initializeAdmin();
});