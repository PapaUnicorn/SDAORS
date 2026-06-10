-- Database schema for GMAHK Performance Reporting & Monitoring System

DROP TABLE IF EXISTS reports_teaching;
DROP TABLE IF EXISTS reports_department;
DROP TABLE IF EXISTS departments;
DROP TABLE IF EXISTS subjects;
DROP TABLE IF EXISTS users;

-- Table: users
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    short_name TEXT NULL, -- e.g. 'RSAB' (Max 5 chars initial, required for roles 2-5)
    username TEXT UNIQUE NOT NULL, -- e.g. 'master' or 'teacher'
    password TEXT NOT NULL,
    role_id INTEGER NOT NULL, -- 1 (Master) to 6 (Teacher)
    branch_code TEXT NOT NULL, -- e.g. '1.1.1.2'
    position TEXT NOT NULL DEFAULT 'President', -- 'President', 'Secretary', 'Treasurer', 'Department', 'Teacher'
    department_name TEXT NULL, -- e.g. 'Youth Ministries (YM)'
    email TEXT NULL,
    phone_number TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table: subjects (Assigned teaching subjects for Teachers)
CREATE TABLE IF NOT EXISTS subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    teacher_id INTEGER NOT NULL,
    subject_name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Table: departments (Assigned departments for MissionConferences)
CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mission_conference_id INTEGER NOT NULL,
    department_name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (mission_conference_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Table: reports_teaching (Teaching reports from Teacher, verified by Institution)
CREATE TABLE IF NOT EXISTS reports_teaching (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, -- Teacher user ID
    academic_year TEXT NOT NULL, -- e.g. '2025/2026'
    term TEXT NOT NULL, -- e.g. '2026-06'
    subject_name TEXT NOT NULL,
    document_link TEXT NULL, -- Google Drive / OneDrive URL
    status TEXT CHECK(status IN ('Not Submitted', 'Approved')) DEFAULT 'Not Submitted',
    feedback TEXT NULL,
    verified_by INTEGER NULL, -- Institution user ID
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Table: reports_department (Department reports from MissionConference, verified by Union)
CREATE TABLE IF NOT EXISTS reports_department (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, -- MissionConference user ID
    term TEXT NOT NULL, -- e.g. '2026-06'
    department_name TEXT NOT NULL,
    document_link TEXT NULL, -- Google Drive / OneDrive URL
    status TEXT CHECK(status IN ('Not Submitted', 'Approved')) DEFAULT 'Not Submitted',
    feedback TEXT NULL,
    verified_by INTEGER NULL, -- Union user ID
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Index for fast hierarchy prefix searching
CREATE INDEX IF NOT EXISTS idx_users_branch_code ON users(branch_code);
CREATE INDEX IF NOT EXISTS idx_reports_teaching_term ON reports_teaching(term);
CREATE INDEX IF NOT EXISTS idx_reports_dept_term ON reports_department(term);
