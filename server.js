const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config();

const dbHelper = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_gmahk_key_default';

app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

// Helper to determine current term (YYYY-MM)
function getCurrentTerm() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-indexed
    
    // In June, or the rest of the first half-year, we default to June term.
    // In December, or the rest of the second half-year, we default to December term.
    if (month <= 5) {
        return `${year}-06`;
    } else {
        return `${year}-12`;
    }
}

// Time-locking checker middleware
function checkTimeLock(req, res, next) {
    // Write actions to reports are only allowed in June and December
    const now = new Date();
    const month = now.getMonth(); // 5 = June, 11 = December
    
    const isOpenWindow = (month === 5 || month === 11);
    
    if (!isOpenWindow) {
        // Master (role 1) bypasses time-locking
        if (req.user && req.user.role_id === 1) {
            return next();
        }
        return res.status(403).json({ 
            error: "Access Locked. Reporting and report modification are only allowed in June and December."
        });
    }
    next();
}

// Authentication Middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: "Token otentikasi diperlukan." });
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: "Invalid or expired token." });
        }
        req.user = user;
        next();
    });
}

// Link Accessibility Validator Function
async function validateLinkAccessibility(url) {
    if (!url) return { valid: false, message: 'URL cannot be empty.' };
    
    // Quick regex validation for HTTP/HTTPS
    const urlPattern = /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([\/\w .-]*)*\/?/;
    if (!urlPattern.test(url)) {
        return { valid: false, message: 'Invalid URL format. Must start with http:// or https://.' };
    }

    // Check if it is a Google Drive or OneDrive link
    const isGoogle = /drive\.google\.com|docs\.google\.com/.test(url);
    const isOneDrive = /onedrive\.live\.com|sharepoint\.com|1drv\.ms/.test(url);

    if (!isGoogle && !isOneDrive) {
        return { valid: false, message: 'Link must be a Google Drive or OneDrive URL.' };
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000); // 4 seconds timeout

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        const finalUrl = response.url;
        
        // If Google Drive / OneDrive link is private, it redirects to accounts/signin
        if (finalUrl.includes('accounts.google.com/ServiceLogin') || 
            finalUrl.includes('signin') || 
            finalUrl.includes('login.live.com') ||
            finalUrl.includes('login.microsoftonline.com') ||
            response.status === 403 || 
            response.status === 404) {
            return { valid: false, message: 'Link is private or requires login. Please set to public ("Anyone with the link can view").' };
        }

        return { valid: true, message: 'Link is valid and publicly accessible.' };
    } catch (err) {
        console.warn("Network ping check failed, falling back to regex verification:", err.message);
        // Fallback for offline sandbox environments
        return { 
            valid: true, 
            warning: true, 
            message: 'Accessibility check failed (Offline). Link format is valid.' 
        };
    }
}

// API: Link accessibility check
app.post('/api/reports/validate-link', authenticateToken, async (req, res) => {
    const { url } = req.body;
    const result = await validateLinkAccessibility(url);
    res.json(result);
});

// API: Authentication Login
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required." });
    }
    
    try {
        const user = await dbHelper.get("SELECT * FROM users WHERE username = ?", [username]);
        if (!user) {
            return res.status(401).json({ error: "Invalid username or password." });
        }
        
        const isMatch = bcrypt.compareSync(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: "Invalid username or password." });
        }
        
        const token = jwt.sign(
            { id: user.id, name: user.name, username: user.username, role_id: user.role_id, branch_code: user.branch_code, position: user.position, department_name: user.department_name },
            JWT_SECRET,
            { expiresIn: '8h' }
        );
        
        res.json({
            token,
            user: {
                id: user.id,
                name: user.name,
                username: user.username,
                role_id: user.role_id,
                branch_code: user.branch_code,
                position: user.position,
                department_name: user.department_name
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal server error occurred." });
    }
});

// API: Get My Profile
app.get('/api/users/me', authenticateToken, async (req, res) => {
    try {
        const user = await dbHelper.get("SELECT id, name, short_name, username, role_id, branch_code, position, department_name, email, phone_number FROM users WHERE id = ?", [req.user.id]);
        if (!user) {
            return res.status(404).json({ error: "User not found." });
        }
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Update User Profile (Name, Email, Phone Number, and optionally Password)
app.put('/api/users/profile', authenticateToken, async (req, res) => {
    const { name, email, phone_number, password } = req.body;
    
    if (!name || !name.trim()) {
        return res.status(400).json({ error: "Name cannot be empty." });
    }
    
    try {
        let sql = "UPDATE users SET name = ?, email = ?, phone_number = ?, updated_at = CURRENT_TIMESTAMP";
        let params = [name.trim(), email ? email.trim() : null, phone_number ? phone_number.trim() : null];
        
        if (password && password.trim()) {
            if (password.trim().length < 6) {
                return res.status(400).json({ error: "New password must be at least 6 characters." });
            }
            const salt = bcrypt.genSaltSync(10);
            const hashedPassword = bcrypt.hashSync(password.trim(), salt);
            sql += ", password = ?";
            params.push(hashedPassword);
        }
        
        sql += " WHERE id = ?";
        params.push(req.user.id);
        
        await dbHelper.run(sql, params);
        res.json({ message: "Profile updated successfully." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

function getDeptAbbrev(deptName) {
    const abbrevMap = {
        "Adventist Chaplaincy Ministries (ACM)": "acm",
        "Children's Ministries (CHM)": "chm",
        "Communication Department (COM)": "com",
        "Education Department (EDU)": "edu",
        "Family Ministries (FM)": "fm",
        "Health Ministries (HM)": "hm",
        "Ministerial Association (MIN)": "min",
        "Planned Giving and Trust Services (PGTS)": "pgts",
        "Public Affairs and Religious Liberty (PARL)": "parl",
        "Publishing Ministries (PUB)": "pub",
        "Sabbath School and Personal Ministries (SSPM)": "sspm",
        "Stewardship Ministries (STEW)": "stew",
        "Women's Ministries (WM)": "wm",
        "Youth Ministries (YM)": "ym",
        "Adventist Development and Relief Agency (ADRA)": "adra",
        "Adventist Mission (Handles Global Mission and Mission Offerings)": "am",
        "Adventist Risk Management (ARM)": "arm",
        "Ellen G. White Estate": "egwe",
        "General Conference Auditing Service (GCAS)": "gcas"
    };
    return abbrevMap[deptName] || "dept";
}

// API: Create User (with strict RBAC and lineage validation)
app.post('/api/users', authenticateToken, async (req, res) => {
    const { name, short_name, password, role_id, parent_id, position, department_name, subjects, departments } = req.body;
    
    if (!name || !password || !role_id) {
        return res.status(400).json({ error: "All input fields are required." });
    }

    const creatorRole = req.user.role_id;
    const targetRoleId = parseInt(role_id, 10);
    const targetPosition = targetRoleId === 6 ? 'Teacher' : (position || 'President');
    
    // 1. RBAC Vertical check
    // Master can create any role (2 to 6).
    // Others can only create same-level officers or lower level.
    if (creatorRole !== 1) {
        if (req.user.position !== 'President') {
            return res.status(403).json({ error: "Only Presidents or Master Admins are allowed to create new users." });
        }
        const isSameLevelOfficer = (targetRoleId === creatorRole && ['Secretary', 'Treasurer', 'Department'].includes(targetPosition));
        const isLowerLevelUser = (targetRoleId === creatorRole + 1);
        if (!isSameLevelOfficer && !isLowerLevelUser) {
            return res.status(403).json({ error: "User creation authority denied. You can only create users for staff at your own level, or users exactly one level below you." });
        }
    } else {
        // Master cannot create Master
        if (targetRoleId === 1) {
            return res.status(403).json({ error: "Cannot create additional Master users." });
        }
    }

    // Validation for position and departments
    if (targetRoleId === 6) {
        if (targetPosition !== 'Teacher') {
            return res.status(400).json({ error: "Teacher role must have Teacher position." });
        }
    } else {
        if (!['President', 'Secretary', 'Treasurer', 'Department'].includes(targetPosition)) {
            return res.status(400).json({ error: "Invalid position." });
        }
        if (targetPosition === 'Department') {
            if (!department_name) {
                return res.status(400).json({ error: "Department name is required if position is Department." });
            }
            const VALID_DEPARTMENTS = [
                "Adventist Chaplaincy Ministries (ACM)",
                "Children's Ministries (CHM)",
                "Communication Department (COM)",
                "Education Department (EDU)",
                "Family Ministries (FM)",
                "Health Ministries (HM)",
                "Ministerial Association (MIN)",
                "Planned Giving and Trust Services (PGTS)",
                "Public Affairs and Religious Liberty (PARL)",
                "Publishing Ministries (PUB)",
                "Sabbath School and Personal Ministries (SSPM)",
                "Stewardship Ministries (STEW)",
                "Women's Ministries (WM)",
                "Youth Ministries (YM)",
                "Adventist Development and Relief Agency (ADRA)",
                "Adventist Mission (Handles Global Mission and Mission Offerings)",
                "Adventist Risk Management (ARM)",
                "Ellen G. White Estate",
                "General Conference Auditing Service (GCAS)"
            ];
            if (!VALID_DEPARTMENTS.includes(department_name)) {
                return res.status(400).json({ error: "Department name not registered." });
            }
        }
    }

    // Validation for short name
    if (targetRoleId >= 2 && targetRoleId <= 5) {
        if (!short_name || !short_name.trim()) {
            return res.status(400).json({ error: "Initials/Short Name are required for Division, Union, Mission/Conference, and Institution levels." });
        }
        if (short_name.trim().length > 5) {
            return res.status(400).json({ error: "Initials/Short Name cannot exceed 5 characters." });
        }
    }

    try {
        // 2. Determine Parent Lineage
        let parentBranchCode = '1';
        let resolvedParentId = null;

        if (creatorRole === 1) {
            // Master creator
            if (targetRoleId === 2 && targetPosition === 'President') {
                // Division President parent is Master (branch code '1')
                parentBranchCode = '1';
            } else {
                // Master must specify parent_id for target role > 2 (or target role 2 officer)
                if (!parent_id) {
                    return res.status(400).json({ error: "parent_id is required if Master creates a user." });
                }
                const parentUser = await dbHelper.get("SELECT id, role_id, branch_code FROM users WHERE id = ?", [parent_id]);
                if (!parentUser) {
                    return res.status(404).json({ error: "Parent user not found." });
                }
                
                let expectedParentRole = targetRoleId - 1;
                if (targetPosition !== 'President' && targetRoleId >= 2 && targetRoleId <= 5) {
                    expectedParentRole = targetRoleId;
                }
                if (parentUser.role_id !== expectedParentRole) {
                    return res.status(400).json({ error: `Parent user must have role level ${expectedParentRole}.` });
                }
                
                parentBranchCode = parentUser.branch_code;
                resolvedParentId = parentUser.id;
            }
        } else {
            // Non-master creator. Creator IS the parent!
            parentBranchCode = req.user.branch_code;
            resolvedParentId = req.user.id;
        }

        // Insert new user with a temporary username first to get auto-incremented ID
        const salt = bcrypt.genSaltSync(10);
        const hashedPassword = bcrypt.hashSync(password, salt);
        const tempUsername = `TEMP_${Date.now()}_${Math.random()}`;
        
        const result = await dbHelper.run(
            `INSERT INTO users (name, short_name, username, password, role_id, branch_code, position, department_name)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                name,
                (targetRoleId >= 2 && targetRoleId <= 5) ? short_name.trim() : null,
                tempUsername,
                hashedPassword,
                targetRoleId,
                'TEMP',
                targetPosition,
                targetPosition === 'Department' ? department_name : null
            ]
        );
        
        const newUserId = result.id;
        let finalBranchCode = "";
        let finalUsername = "";
        
        const baseBranch = parentBranchCode;
        const baseUsernameClean = baseBranch.split('.').join('');
        
        if (targetPosition === 'President' || targetPosition === 'Teacher') {
            finalBranchCode = `${baseBranch}.${newUserId}`;
            finalUsername = finalBranchCode.split('.').join('');
        } else if (targetPosition === 'Secretary') {
            finalBranchCode = baseBranch;
            finalUsername = `${baseUsernameClean}sec`;
        } else if (targetPosition === 'Treasurer') {
            finalBranchCode = baseBranch;
            finalUsername = `${baseUsernameClean}treas`;
        } else if (targetPosition === 'Department') {
            finalBranchCode = baseBranch;
            finalUsername = `${baseUsernameClean}${getDeptAbbrev(department_name)}`;
        }
        
        // Double check duplicate username (virtually impossible but safe)
        const existingUser = await dbHelper.get("SELECT id FROM users WHERE username = ?", [finalUsername]);
        if (existingUser) {
            await dbHelper.run("DELETE FROM users WHERE id = ?", [newUserId]);
            return res.status(400).json({ error: "Username already registered." });
        }
        
        // Update user with correct branch_code and username
        await dbHelper.run("UPDATE users SET branch_code = ?, username = ? WHERE id = ?", [finalBranchCode, finalUsername, newUserId]);

        // 3. Assign subjects/departments if provided (legacy support)
        if (targetRoleId === 6 && Array.isArray(subjects)) {
            // Teacher subjects
            for (const sub of subjects) {
                if (sub.trim()) {
                    await dbHelper.run("INSERT INTO subjects (teacher_id, subject_name) VALUES (?, ?)", [newUserId, sub.trim()]);
                }
            }
        } else if (targetRoleId === 4 && targetPosition === 'President' && Array.isArray(departments)) {
            // MC departments
            for (const dept of departments) {
                if (dept.trim()) {
                    await dbHelper.run("INSERT INTO departments (mission_conference_id, department_name) VALUES (?, ?)", [newUserId, dept.trim()]);
                }
            }
        }

        res.status(201).json({
            message: "User created successfully.",
            user: {
                id: newUserId,
                name,
                short_name: (targetRoleId >= 2 && targetRoleId <= 5) ? short_name.trim() : null,
                username: finalUsername,
                role_id: targetRoleId,
                branch_code: finalBranchCode,
                position: targetPosition,
                department_name: targetPosition === 'Department' ? department_name : null
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Gagal membuat user: " + err.message });
    }
});

// API: Delete User (with RBAC and horizontal isolation check)
app.delete('/api/users/:id', authenticateToken, async (req, res) => {
    const deleteId = parseInt(req.params.id, 10);
    
    if (req.user.id === deleteId) {
        return res.status(400).json({ error: "You cannot delete your own account." });
    }
    
    try {
        const targetUser = await dbHelper.get("SELECT id, role_id, branch_code FROM users WHERE id = ?", [deleteId]);
        if (!targetUser) {
            return res.status(404).json({ error: "User not found." });
        }
        
        // Master can delete anyone except Master (role_id === 1)
        if (req.user.role_id === 1) {
            if (targetUser.role_id === 1) {
                return res.status(403).json({ error: "Other Master accounts cannot be deleted." });
            }
        } else {
            // Non-master checks:
            // 1. Horizontal: must be in branch
            if (!targetUser.branch_code.startsWith(req.user.branch_code + '.')) {
                return res.status(403).json({ error: "Access denied. User is outside your branch lineage." });
            }
            // 2. Vertical: must be superior role
            if (req.user.role_id >= targetUser.role_id) {
                return res.status(403).json({ error: "You can only delete user accounts at levels below you." });
            }
        }
        
        // Delete user AND all their descendants (branch_code starts with targetUser.branch_code + '.')
        await dbHelper.run("DELETE FROM users WHERE id = ? OR branch_code LIKE ?", [deleteId, `${targetUser.branch_code}.%`]);
        res.json({ message: "User and all of their sub-branches deleted successfully." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Get Subordinates (filtered by lineage path for horizontal isolation)
app.get('/api/users/subordinates', authenticateToken, async (req, res) => {
    try {
        let sql = "";
        let params = [];
        
        if (req.user.role_id === 1) {
            // Master sees everyone
            sql = "SELECT id, name, short_name, username, role_id, branch_code FROM users WHERE id != ? ORDER BY role_id ASC, name ASC";
            params = [req.user.id];
        } else {
            // Horizontal isolation: only users under creator's branch_code
            sql = "SELECT id, name, short_name, username, role_id, branch_code FROM users WHERE id != ? AND branch_code LIKE ? ORDER BY role_id ASC, name ASC";
            params = [req.user.id, `${req.user.branch_code}.%`];
        }
        
        const users = await dbHelper.query(sql, params);
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Assign Subjects (for Teachers) / Departments (for MissionConferences)
app.post('/api/users/assign-items', authenticateToken, async (req, res) => {
    const { userId, items } = req.body; // items is array of strings
    if (!userId || !Array.isArray(items)) {
        return res.status(400).json({ error: "userId and items list are required." });
    }

    try {
        const targetUser = await dbHelper.get("SELECT id, role_id, branch_code FROM users WHERE id = ?", [userId]);
        if (!targetUser) {
            return res.status(404).json({ error: "User not found." });
        }

        // Horizontal check
        if (req.user.role_id !== 1 && !targetUser.branch_code.startsWith(req.user.branch_code)) {
            return res.status(403).json({ error: "Access denied. User is outside your branch lineage." });
        }

        // Check if verifier or Master
        if (req.user.role_id !== 1 && req.user.role_id >= targetUser.role_id) {
            return res.status(403).json({ error: "You are not authorized to manage this user's items." });
        }

        if (targetUser.role_id === 6) {
            // Delete old subjects and insert new ones
            await dbHelper.run("DELETE FROM subjects WHERE teacher_id = ?", [userId]);
            for (const sub of items) {
                if (sub.trim()) {
                    await dbHelper.run("INSERT INTO subjects (teacher_id, subject_name) VALUES (?, ?)", [userId, sub.trim()]);
                }
            }
            return res.json({ message: "Subjects updated successfully." });
        } else if (targetUser.role_id === 4) {
            // Delete old departments and insert new ones
            await dbHelper.run("DELETE FROM departments WHERE mission_conference_id = ?", [userId]);
            for (const dept of items) {
                if (dept.trim()) {
                    await dbHelper.run("INSERT INTO departments (mission_conference_id, department_name) VALUES (?, ?)", [userId, dept.trim()]);
                }
            }
            return res.json({ message: "Departments updated successfully." });
        } else {
            return res.status(400).json({ error: "Only Teacher or Mission / Conference roles can have report duty items." });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Get Assigned reporting items for logged in user (Teacher, MC, Secretary, Treasurer, Department)
app.get('/api/reports/my-items', authenticateToken, async (req, res) => {
    const term = req.query.term || getCurrentTerm();
    const targetUserId = req.query.userId ? parseInt(req.query.userId, 10) : req.user.id;
    
    try {
        let targetUser = req.user;
        if (targetUserId !== req.user.id) {
            targetUser = await dbHelper.get("SELECT id, role_id, branch_code, position, department_name FROM users WHERE id = ?", [targetUserId]);
            if (!targetUser) {
                return res.status(404).json({ error: "Target user not found." });
            }
            if (req.user.role_id !== 1) {
                // Horizontal check
                if (!targetUser.branch_code.startsWith(req.user.branch_code)) {
                    return res.status(403).json({ error: "Access denied. Target user is outside your branch lineage." });
                }

                let isAuthorized = false;

                if (req.user.role_id === targetUser.role_id) {
                    // Same level check: Only President can view Secretary, Treasurer, or Department
                    if (req.user.position === 'President' && ['Secretary', 'Treasurer', 'Department'].includes(targetUser.position)) {
                        isAuthorized = true;
                    }
                } else if (req.user.role_id < targetUser.role_id) {
                    // Lower level check
                    if (req.user.position === 'President') {
                        if ([2, 3, 4].includes(req.user.role_id)) {
                            // Division/Union/MC President can only view down to MC level (role <= 4)
                            if (targetUser.role_id <= 4) {
                                isAuthorized = true;
                            }
                        } else if (req.user.role_id === 5) {
                            // Institution President can only view Teacher reports (role 6)
                            if (targetUser.role_id === 6) {
                                isAuthorized = true;
                            }
                        }
                    } else if (req.user.position === 'Secretary') {
                        // Secretary can only view Secretary at the next lower level
                        if (targetUser.position === 'Secretary' && targetUser.role_id === req.user.role_id + 1) {
                            isAuthorized = true;
                        }
                    } else if (req.user.position === 'Treasurer') {
                        // Treasurer can only view Treasurer at the next lower level
                        if (targetUser.position === 'Treasurer' && targetUser.role_id === req.user.role_id + 1) {
                            isAuthorized = true;
                        }
                    } else if (req.user.position === 'Department') {
                        // Department can only view same department at next lower level or legacy MC President
                        if (targetUser.role_id === req.user.role_id + 1) {
                            if (targetUser.position === 'Department' && targetUser.department_name === req.user.department_name) {
                                isAuthorized = true;
                            } else if (targetUser.position === 'President') {
                                // For MC President (legacy reporting) we will allow checking, but we'll filter items returned
                                isAuthorized = true;
                            }
                        }
                    }
                }

                if (!isAuthorized) {
                    return res.status(403).json({ error: "Access denied. You are not authorized to view this user's items." });
                }
            }
        }

        if (targetUser.role_id === 6) {
            // Get Teacher subjects and their report status for this term
            const rows = await dbHelper.query(
                `SELECT s.subject_name, r.id as report_id, r.academic_year, r.document_link, 
                        COALESCE(r.status, 'Not Submitted') as status, r.feedback, v.name as verifier_name
                 FROM subjects s
                 LEFT JOIN reports_teaching r ON r.user_id = s.teacher_id AND r.subject_name = s.subject_name AND r.term = ?
                 LEFT JOIN users v ON r.verified_by = v.id
                 WHERE s.teacher_id = ?`,
                [term, targetUserId]
            );
            return res.json({ role: 6, position: targetUser.position, items: rows });
        } else if (targetUser.role_id === 4 && targetUser.position === 'President') {
            // Get MC departments and report status for this term (legacy MC President view)
            let rows = await dbHelper.query(
                `SELECT d.department_name, r.id as report_id, r.document_link, 
                        COALESCE(r.status, 'Not Submitted') as status, r.feedback, v.name as verifier_name
                 FROM departments d
                 LEFT JOIN reports_department r ON r.user_id = d.mission_conference_id AND r.department_name = d.department_name AND r.term = ?
                 LEFT JOIN users v ON r.verified_by = v.id
                 WHERE d.mission_conference_id = ?`,
                [term, targetUserId]
            );
            // Department isolation: Filter MC President's items to show only the requester's department if requester is a Department user
            if (req.user.role_id !== 1 && req.user.position === 'Department') {
                rows = rows.filter(r => r.department_name === req.user.department_name);
            }
            return res.json({ role: 4, position: 'President', items: rows });
        } else if (['Secretary', 'Treasurer', 'Department'].includes(targetUser.position)) {
            // Single report item for Secretary, Treasurer, or Department
            const itemName = targetUser.position === 'Department' ? targetUser.department_name : targetUser.position;
            const rows = await dbHelper.query(
                `SELECT ? as department_name, r.id as report_id, r.document_link, 
                        COALESCE(r.status, 'Not Submitted') as status, r.feedback, v.name as verifier_name
                 FROM (SELECT 1)
                 LEFT JOIN reports_department r ON r.user_id = ? AND r.department_name = ? AND r.term = ?
                 LEFT JOIN users v ON r.verified_by = v.id`,
                [itemName, targetUserId, itemName, term]
            );
            return res.json({ role: targetUser.role_id, position: targetUser.position, items: rows });
        } else {
            return res.status(400).json({ error: "This account does not have any reporting items." });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Submit Report (Time-locked, Link-validated)
app.post('/api/reports/submit', authenticateToken, checkTimeLock, async (req, res) => {
    const { itemName, documentLink, academicYear, term } = req.body;
    
    if (!itemName || !documentLink || !term) {
        return res.status(400).json({ error: "Item name, document link, and term fields are required." });
    }

    // Validate link first
    const linkValidation = await validateLinkAccessibility(documentLink);
    if (!linkValidation.valid) {
        return res.status(400).json({ error: linkValidation.message });
    }

    try {
        if (req.user.role_id === 6) {
            // Teacher reports
            if (!academicYear) {
                return res.status(400).json({ error: "Academic year is required for teacher reports." });
            }

            // Verify teacher has this subject
            const sub = await dbHelper.get("SELECT id FROM subjects WHERE teacher_id = ? AND subject_name = ?", [req.user.id, itemName]);
            if (!sub) {
                return res.status(400).json({ error: "You are not registered to teach this subject." });
            }

            // Check if already approved (locked permanently)
            const existing = await dbHelper.get(
                "SELECT id, status FROM reports_teaching WHERE user_id = ? AND subject_name = ? AND term = ?",
                [req.user.id, itemName, term]
            );
            
            if (existing && existing.status === 'Approved') {
                return res.status(400).json({ error: "Report has been approved and locked. Cannot be modified." });
            }

            if (existing) {
                // Update
                await dbHelper.run(
                    `UPDATE reports_teaching 
                     SET document_link = ?, academic_year = ?, status = 'Not Submitted', feedback = NULL, verified_by = NULL, updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [documentLink, academicYear, existing.id]
                );
            } else {
                // Insert
                await dbHelper.run(
                    `INSERT INTO reports_teaching (user_id, academic_year, term, subject_name, document_link, status)
                     VALUES (?, ?, ?, ?, ?, 'Not Submitted')`,
                    [req.user.id, academicYear, term, itemName, documentLink]
                );
            }

            res.json({ message: "Report submitted successfully and pending review." });

        } else if (req.user.role_id === 4 && req.user.position === 'President') {
            // Legacy MC President reports (assigned departments in departments table)
            const dept = await dbHelper.get("SELECT id FROM departments WHERE mission_conference_id = ? AND department_name = ?", [req.user.id, itemName]);
            if (!dept) {
                return res.status(400).json({ error: "You do not own this department." });
            }

            // Check if already approved
            const existing = await dbHelper.get(
                "SELECT id, status FROM reports_department WHERE user_id = ? AND department_name = ? AND term = ?",
                [req.user.id, itemName, term]
            );
            
            if (existing && existing.status === 'Approved') {
                return res.status(400).json({ error: "Report has been approved and locked. Cannot be modified." });
            }

            if (existing) {
                await dbHelper.run(
                    `UPDATE reports_department 
                     SET document_link = ?, status = 'Not Submitted', feedback = NULL, verified_by = NULL, updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [documentLink, existing.id]
                );
            } else {
                await dbHelper.run(
                    `INSERT INTO reports_department (user_id, term, department_name, document_link, status)
                     VALUES (?, ?, ?, ?, 'Not Submitted')`,
                    [req.user.id, term, itemName, documentLink]
                );
            }

            res.json({ message: "Department report submitted successfully and pending review." });

        } else if (['Secretary', 'Treasurer', 'Department'].includes(req.user.position)) {
            // Officers and Department users report their specific item
            const expectedItemName = req.user.position === 'Department' ? req.user.department_name : req.user.position;
            if (itemName !== expectedItemName) {
                return res.status(400).json({ error: `You are only allowed to submit reports for ${expectedItemName}.` });
            }

            // Check if already approved
            const existing = await dbHelper.get(
                "SELECT id, status FROM reports_department WHERE user_id = ? AND department_name = ? AND term = ?",
                [req.user.id, itemName, term]
            );
            
            if (existing && existing.status === 'Approved') {
                return res.status(400).json({ error: "Report has been approved and locked. Cannot be modified." });
            }

            if (existing) {
                await dbHelper.run(
                    `UPDATE reports_department 
                     SET document_link = ?, status = 'Not Submitted', feedback = NULL, verified_by = NULL, updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [documentLink, existing.id]
                );
            } else {
                await dbHelper.run(
                    `INSERT INTO reports_department (user_id, term, department_name, document_link, status)
                     VALUES (?, ?, ?, ?, 'Not Submitted')`,
                    [req.user.id, term, itemName, documentLink]
                );
            }

            res.json({ message: "Report submitted successfully and pending review." });

        } else {
            res.status(400).json({ error: "Only Teachers or department/office staff can submit reports." });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Get Verification Queue (for Master Admin, Presidents, and Departments)
app.get('/api/reports/verification-queue', authenticateToken, async (req, res) => {
    const term = req.query.term || getCurrentTerm();
    const role = req.user.role_id;
    const position = req.user.position;
    
    try {
        if (role === 1) {
            // Master Admin verifies everything
            const teaching = await dbHelper.query(
                `SELECT r.id, r.user_id, COALESCE(u.name || ' (' || u.short_name || ')', u.name) as sender_name, r.academic_year, r.term, r.subject_name as item_name, 
                        r.document_link, r.status, r.feedback, r.created_at, r.updated_at
                 FROM reports_teaching r
                 JOIN users u ON r.user_id = u.id
                 WHERE r.term = ? AND r.document_link IS NOT NULL`,
                [term]
            );
            const dept = await dbHelper.query(
                `SELECT r.id, r.user_id, COALESCE(u.name || ' (' || u.short_name || ')', u.name) as sender_name, r.term, r.department_name as item_name, 
                        r.document_link, r.status, r.feedback, r.created_at, r.updated_at
                 FROM reports_department r
                 JOIN users u ON r.user_id = u.id
                 WHERE r.term = ? AND r.document_link IS NOT NULL`,
                [term]
            );
            return res.json({ type: 'all', teaching, department: dept });
        }

        if (position === 'President') {
            if ([2, 3, 4].includes(role)) {
                // Division/Union/MC President verifies same-level Secretary, Treasurer, Departments AND lower-level office reports (role <= 4)
                const teaching = []; // Presidents do not verify Teacher reports (except Institution level)
                const dept = await dbHelper.query(
                    `SELECT r.id, r.user_id, COALESCE(u.name || ' (' || u.short_name || ')', u.name) as sender_name, r.term, r.department_name as item_name, 
                            r.document_link, r.status, r.feedback, r.created_at, r.updated_at
                     FROM reports_department r
                     JOIN users u ON r.user_id = u.id
                     WHERE r.term = ? 
                       AND u.branch_code LIKE ? 
                       AND r.document_link IS NOT NULL
                       AND (
                           (u.role_id = ? AND u.position IN ('Secretary', 'Treasurer', 'Department'))
                           OR
                           (u.role_id > ? AND u.role_id <= 4)
                       )
                     ORDER BY r.status DESC, r.updated_at DESC`,
                    [term, `${req.user.branch_code}%`, role, role]
                );
                return res.json({ type: 'all', teaching, department: dept });
            } else if (role === 5) {
                // Institution President verifies Teachers in branch
                const teaching = await dbHelper.query(
                    `SELECT r.id, r.user_id, COALESCE(u.name || ' (' || u.short_name || ')', u.name) as sender_name, r.academic_year, r.term, r.subject_name as item_name, 
                            r.document_link, r.status, r.feedback, r.created_at, r.updated_at
                     FROM reports_teaching r
                     JOIN users u ON r.user_id = u.id
                     WHERE r.term = ? AND u.branch_code LIKE ? AND r.document_link IS NOT NULL
                     ORDER BY r.status DESC, r.updated_at DESC`,
                    [term, `${req.user.branch_code}.%`]
                );
                return res.json({ type: 'all', teaching, department: [] });
            } else {
                return res.json({ type: 'all', teaching: [], department: [] });
            }

        } else if (position === 'Secretary') {
            // Secretary checks reports of Secretary from next lower level in their branch
            const reports = await dbHelper.query(
                `SELECT r.id, r.user_id, COALESCE(u.name || ' (' || u.short_name || ')', u.name) as sender_name, r.term, r.department_name as item_name, 
                        r.document_link, r.status, r.feedback, r.created_at, r.updated_at
                 FROM reports_department r
                 JOIN users u ON r.user_id = u.id
                 WHERE r.term = ? 
                   AND u.role_id = ? 
                   AND u.branch_code LIKE ? 
                   AND u.position = 'Secretary'
                   AND r.document_link IS NOT NULL
                 ORDER BY r.status DESC, r.updated_at DESC`,
                [term, role + 1, `${req.user.branch_code}.%`]
            );
            return res.json({ type: 'department', reports });

        } else if (position === 'Treasurer') {
            // Treasurer/Finance checks reports of Treasurer from next lower level in their branch
            const reports = await dbHelper.query(
                `SELECT r.id, r.user_id, COALESCE(u.name || ' (' || u.short_name || ')', u.name) as sender_name, r.term, r.department_name as item_name, 
                        r.document_link, r.status, r.feedback, r.created_at, r.updated_at
                 FROM reports_department r
                 JOIN users u ON r.user_id = u.id
                 WHERE r.term = ? 
                   AND u.role_id = ? 
                   AND u.branch_code LIKE ? 
                   AND u.position = 'Treasurer'
                   AND r.document_link IS NOT NULL
                 ORDER BY r.status DESC, r.updated_at DESC`,
                [term, role + 1, `${req.user.branch_code}.%`]
            );
            return res.json({ type: 'department', reports });

        } else if (position === 'Department') {
            // Department user verifies reports of the SAME department name from the next lower level in their branch
            // Also handles legacy MC President reports of that department name.
            const reports = await dbHelper.query(
                `SELECT r.id, r.user_id, COALESCE(u.name || ' (' || u.short_name || ')', u.name) as sender_name, r.term, r.department_name as item_name, 
                        r.document_link, r.status, r.feedback, r.created_at, r.updated_at
                 FROM reports_department r
                 JOIN users u ON r.user_id = u.id
                 WHERE r.term = ? 
                   AND u.role_id = ? 
                   AND u.branch_code LIKE ? 
                   AND ( (u.position = 'Department' AND u.department_name = ?) OR (u.position = 'President' AND r.department_name = ?) )
                   AND r.document_link IS NOT NULL
                 ORDER BY r.status DESC, r.updated_at DESC`,
                [term, role + 1, `${req.user.branch_code}.%`, req.user.department_name, req.user.department_name]
            );
            return res.json({ type: 'department', reports });
        } else {
            return res.status(403).json({ error: "Your role/position does not have authority to verify reports." });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Verify Report (Approve / Reject & Feedback)
app.put('/api/reports/verify/:id', authenticateToken, checkTimeLock, async (req, res) => {
    const reportId = req.params.id;
    const { type, action, feedback } = req.body; // type: 'teaching' | 'department', action: 'approve' | 'reject'
    const role = req.user.role_id;

    if (!type || !action) {
        return res.status(400).json({ error: "Report type and action are required." });
    }

    try {
        let report = null;
        let owner = null;

        // Fetch report and owner
        if (type === 'teaching') {
            report = await dbHelper.get("SELECT * FROM reports_teaching WHERE id = ?", [reportId]);
            if (report) {
                owner = await dbHelper.get("SELECT role_id, branch_code, position, department_name FROM users WHERE id = ?", [report.user_id]);
            }
        } else if (type === 'department') {
            report = await dbHelper.get("SELECT * FROM reports_department WHERE id = ?", [reportId]);
            if (report) {
                owner = await dbHelper.get("SELECT role_id, branch_code, position, department_name FROM users WHERE id = ?", [report.user_id]);
            }
        }

        if (!report || !owner) {
            return res.status(404).json({ error: "Report not found." });
        }

        // 1. Verify Role Authority & Horizontal Isolation
        if (role !== 1) {
            // Horizontal Check
            if (!owner.branch_code.startsWith(req.user.branch_code)) {
                return res.status(403).json({ error: "Access denied. Report is outside your branch lineage." });
            }

            let isAuthorized = false;

            if (req.user.position === 'President') {
                if (role === 5) {
                    // Institution President verifies Teachers in branch
                    if (type === 'teaching' && owner.role_id === 6 && owner.branch_code.startsWith(req.user.branch_code + '.')) {
                        isAuthorized = true;
                    }
                } else if ([2, 3, 4].includes(role)) {
                    // Division/Union/MC President verifies office/department reports only (role <= 4)
                    if (type === 'department' && owner.role_id <= 4) {
                        if (owner.role_id === role) {
                            // Same level: Secretary, Treasurer, and all Departments
                            if (['Secretary', 'Treasurer', 'Department'].includes(owner.position)) {
                                isAuthorized = true;
                            }
                        } else if (owner.role_id > role) {
                            // Lower level: Presidents, Secretaries, Treasurers, and all Departments in their branch
                            if (owner.branch_code.startsWith(req.user.branch_code + '.')) {
                                isAuthorized = true;
                            }
                        }
                    }
                }
            } else if (req.user.position === 'Secretary') {
                // Secretary verifies Secretary at next lower level in branch
                if (type === 'department' && owner.position === 'Secretary' && owner.role_id === role + 1 && owner.branch_code.startsWith(req.user.branch_code + '.')) {
                    isAuthorized = true;
                }
            } else if (req.user.position === 'Treasurer') {
                // Treasurer verifies Treasurer at next lower level in branch
                if (type === 'department' && owner.position === 'Treasurer' && owner.role_id === role + 1 && owner.branch_code.startsWith(req.user.branch_code + '.')) {
                    isAuthorized = true;
                }
            } else if (req.user.position === 'Department') {
                // Department verifies same department name at next lower level in branch
                if (type === 'department' && owner.role_id === role + 1 && owner.branch_code.startsWith(req.user.branch_code + '.')) {
                    if (owner.position === 'Department' && owner.department_name === req.user.department_name) {
                        isAuthorized = true;
                    } else if (owner.position === 'President' && report.department_name === req.user.department_name) {
                        // Legacy MC President report
                        isAuthorized = true;
                    }
                }
            }

            if (!isAuthorized) {
                return res.status(403).json({ error: "Access denied. You are not authorized to verify this report." });
            }
        }

        // 2. Perform verification action
        if (action === 'approve') {
            if (type === 'teaching') {
                await dbHelper.run(
                    `UPDATE reports_teaching 
                     SET status = 'Approved', feedback = ?, verified_by = ?, updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [feedback || null, req.user.id, reportId]
                );
            } else {
                await dbHelper.run(
                    `UPDATE reports_department 
                     SET status = 'Approved', feedback = ?, verified_by = ?, updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [feedback || null, req.user.id, reportId]
                );
            }
            res.json({ message: "Report approved and locked successfully." });
        } else if (action === 'reject') {
            // Reject action: deletes link, reverts status to 'Not Submitted', saves feedback.
            if (type === 'teaching') {
                await dbHelper.run(
                    `UPDATE reports_teaching 
                     SET document_link = NULL, status = 'Not Submitted', feedback = ?, verified_by = ?, updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [feedback || 'Tautan ditolak oleh verifikator.', req.user.id, reportId]
                );
            } else {
                await dbHelper.run(
                    `UPDATE reports_department 
                     SET document_link = NULL, status = 'Not Submitted', feedback = ?, verified_by = ?, updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [feedback || 'Tautan ditolak oleh verifikator.', req.user.id, reportId]
                );
            }
            res.json({ message: "Report rejected successfully. Document link cleared and status reset to 'Not Submitted'." });
        } else {
            res.status(400).json({ error: "Unknown action (Use 'approve' or 'reject')." });
        }

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: Get Dashboard Stats & Unsubmitted blacklisted reports
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
    const term = req.query.term || getCurrentTerm();
    const userBranch = req.user.branch_code;
    const isMaster = req.user.role_id === 1;

    try {
        // We need:
        // 1. Total Target items (subjects from Teachers + depts from MCs + officers/depts users in branch)
        // 2. Approved items in this term
        // 3. Not Submitted items (items with NULL reports or reports not approved)
        // 4. List of users with unsubmitted items (either missing entirely or partially completed)
        
        let subjectsQuery = "";
        let deptsQuery = "";
        let officersQuery = "";
        let subjectsParams = [];
        let deptsParams = [];
        let officersParams = [];

        if (isMaster) {
            subjectsQuery = `
                SELECT s.id as item_id, s.subject_name as item_name, s.teacher_id as user_id, COALESCE(u.name || ' (' || u.short_name || ')', u.name) as user_name, u.username as user_username,
                       r.id as report_id, r.document_link, COALESCE(r.status, 'Not Submitted') as status, r.feedback
                FROM subjects s
                JOIN users u ON s.teacher_id = u.id
                LEFT JOIN reports_teaching r ON r.user_id = s.teacher_id AND r.subject_name = s.subject_name AND r.term = ?
            `;
            subjectsParams = [term];

            deptsQuery = `
                SELECT d.id as item_id, d.department_name as item_name, d.mission_conference_id as user_id, COALESCE(u.name || ' (' || u.short_name || ')', u.name) as user_name, u.username as user_username,
                       r.id as report_id, r.document_link, COALESCE(r.status, 'Not Submitted') as status, r.feedback
                FROM departments d
                JOIN users u ON d.mission_conference_id = u.id
                LEFT JOIN reports_department r ON r.user_id = d.mission_conference_id AND r.department_name = d.department_name AND r.term = ?
            `;
            deptsParams = [term];

            officersQuery = `
                SELECT u.id as item_id, u.position as item_name, u.id as user_id, COALESCE(u.name || ' (' || u.short_name || ')', u.name) as user_name, u.username as user_username,
                       r.id as report_id, r.document_link, COALESCE(r.status, 'Not Submitted') as status, r.feedback, u.position, u.department_name
                FROM users u
                LEFT JOIN reports_department r ON r.user_id = u.id AND r.department_name = (CASE WHEN u.position = 'Department' THEN u.department_name ELSE u.position END) AND r.term = ?
                WHERE u.position IN ('Secretary', 'Treasurer', 'Department')
            `;
            officersParams = [term];
        } else {
            // Filter by branch path prefix
            subjectsQuery = `
                SELECT s.id as item_id, s.subject_name as item_name, s.teacher_id as user_id, COALESCE(u.name || ' (' || u.short_name || ')', u.name) as user_name, u.username as user_username,
                       r.id as report_id, r.document_link, COALESCE(r.status, 'Not Submitted') as status, r.feedback
                FROM subjects s
                JOIN users u ON s.teacher_id = u.id
                LEFT JOIN reports_teaching r ON r.user_id = s.teacher_id AND r.subject_name = s.subject_name AND r.term = ?
                WHERE u.branch_code LIKE ?
            `;
            subjectsParams = [term, `${userBranch}%`];

            deptsQuery = `
                SELECT d.id as item_id, d.department_name as item_name, d.mission_conference_id as user_id, COALESCE(u.name || ' (' || u.short_name || ')', u.name) as user_name, u.username as user_username,
                       r.id as report_id, r.document_link, COALESCE(r.status, 'Not Submitted') as status, r.feedback
                FROM departments d
                JOIN users u ON d.mission_conference_id = u.id
                LEFT JOIN reports_department r ON r.user_id = d.mission_conference_id AND r.department_name = d.department_name AND r.term = ?
                WHERE u.branch_code LIKE ?
            `;
            deptsParams = [term, `${userBranch}%`];

            officersQuery = `
                SELECT u.id as item_id, u.position as item_name, u.id as user_id, COALESCE(u.name || ' (' || u.short_name || ')', u.name) as user_name, u.username as user_username,
                       r.id as report_id, r.document_link, COALESCE(r.status, 'Not Submitted') as status, r.feedback, u.position, u.department_name
                FROM users u
                LEFT JOIN reports_department r ON r.user_id = u.id AND r.department_name = (CASE WHEN u.position = 'Department' THEN u.department_name ELSE u.position END) AND r.term = ?
                WHERE u.position IN ('Secretary', 'Treasurer', 'Department') AND u.branch_code LIKE ?
            `;
            officersParams = [term, `${userBranch}%`];
        }

        const subjectsData = await dbHelper.query(subjectsQuery, subjectsParams);
        const deptsData = await dbHelper.query(deptsQuery, deptsParams);
        const officersData = await dbHelper.query(officersQuery, officersParams);

        // Map officersData correctly to standard keys
        const officersDataMapped = officersData.map(x => {
            let itemName = x.item_name;
            let typeLabel = "";
            if (x.position === 'Secretary') {
                itemName = 'Secretary';
                typeLabel = 'Secretary (Sekretaris)';
            } else if (x.position === 'Treasurer') {
                itemName = 'Treasurer';
                typeLabel = 'Treasurer (Bendahara)';
            } else if (x.position === 'Department') {
                itemName = x.department_name;
                typeLabel = 'Department (Departemen)';
            }
            return {
                item_id: x.item_id,
                item_name: itemName,
                user_id: x.user_id,
                user_name: x.user_name,
                user_username: x.user_username,
                report_id: x.report_id,
                document_link: x.document_link,
                status: x.status,
                feedback: x.feedback,
                type: typeLabel
            };
        });

        // Combine items
        const allItems = [
            ...subjectsData.map(x => ({ ...x, type: 'Teaching (Guru)' })),
            ...deptsData.map(x => ({ ...x, type: 'Department (Misi/Konf)' })),
            ...officersDataMapped
        ];

        const totalTarget = allItems.length;
        const approvedItems = allItems.filter(x => x.status === 'Approved');
        const approvedCount = approvedItems.length;
        const notSubmittedCount = totalTarget - approvedCount;
        const completionPercentage = totalTarget > 0 ? Math.round((approvedCount / totalTarget) * 1000) / 10 : 0;

        // Unsubmitted Reports blacklist
        // Includes anyone whose status is NOT 'Approved'
        const unsubmittedList = allItems.filter(x => x.status !== 'Approved').map(x => ({
            userId: x.user_id,
            userName: x.user_name,
            userUsername: x.user_username,
            type: x.type,
            itemName: x.item_name,
            documentLink: x.document_link,
            status: x.document_link ? 'Menunggu Verifikasi' : 'Belum Mengisi Tautan',
            feedback: x.feedback
        }));

        res.json({
            term,
            metrics: {
                totalTarget,
                approved: approvedCount,
                notSubmitted: notSubmittedCount,
                percentage: completionPercentage
            },
            unsubmitted: unsubmittedList
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Start Server and init DB
dbHelper.initDb().then(() => {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}).catch(err => {
    console.error("Database initialization failed. App stopping.", err);
});
