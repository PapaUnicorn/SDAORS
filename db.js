const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'database.sqlite');
const schemaPath = path.join(__dirname, 'schema.sql');

const db = new sqlite3.Database(dbPath);

function initDb() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Read and run schema.sql
            const schemaSql = fs.readFileSync(schemaPath, 'utf8');
            db.exec(schemaSql, (err) => {
                if (err) {
                    console.error("Error creating database schema:", err);
                    return reject(err);
                }
                console.log("Database schema initialized.");
                seedData().then(resolve).catch(reject);
            });
        });
    });
}

function query(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ id: this.lastID, changes: this.changes });
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

// Helper to determine clean name and short name (initials) max 5 chars
function generateShortName(name) {
    // 1. Check if name has parentheses, e.g., "Southern Asia-Pacific Division (SSD)"
    const parenMatch = name.match(/\(([^)]+)\)/);
    if (parenMatch) {
        const short = parenMatch[1].trim();
        if (short.length <= 5) {
            const cleanName = name.replace(/\s*\([^)]+\)/, '').trim();
            return { name: cleanName, shortName: short };
        }
    }
    
    // 2. Otherwise, generate initials from the name
    const words = name.split(/[\s\-\/]+/).filter(w => w.length > 0);
    let short = "";
    
    for (const word of words) {
        const cleanWord = word.replace(/[^a-zA-Z]/g, '');
        if (!cleanWord) continue;
        
        const lower = cleanWord.toLowerCase();
        if (lower === 'of' || lower === 'and' || lower === 'in' || lower === 'the' || lower === 'for') {
            continue;
        }
        
        // If word is already uppercase and short, use it. Otherwise, use first letter.
        if (cleanWord === cleanWord.toUpperCase() && cleanWord.length <= 3) {
            short += cleanWord;
        } else {
            short += cleanWord[0].toUpperCase();
        }
    }
    
    short = short.substring(0, 5);
    return { name: name.trim(), shortName: short };
}

const RAW_HIERARCHY_DATA = fs.readFileSync(path.join(__dirname, 'hierarchy.txt'), 'utf8');

const DEPARTMENTS_INFO = [
    { name: "Adventist Chaplaincy Ministries (ACM)", abbrev: "acm" },
    { name: "Children's Ministries (CHM)", abbrev: "chm" },
    { name: "Communication Department (COM)", abbrev: "com" },
    { name: "Education Department (EDU)", abbrev: "edu" },
    { name: "Family Ministries (FM)", abbrev: "fm" },
    { name: "Health Ministries (HM)", abbrev: "hm" },
    { name: "Ministerial Association (MIN)", abbrev: "min" },
    { name: "Planned Giving and Trust Services (PGTS)", abbrev: "pgts" },
    { name: "Public Affairs and Religious Liberty (PARL)", abbrev: "parl" },
    { name: "Publishing Ministries (PUB)", abbrev: "pub" },
    { name: "Sabbath School and Personal Ministries (SSPM)", abbrev: "sspm" },
    { name: "Stewardship Ministries (STEW)", abbrev: "stew" },
    { name: "Women's Ministries (WM)", abbrev: "wm" },
    { name: "Youth Ministries (YM)", abbrev: "ym" },
    { name: "Adventist Development and Relief Agency (ADRA)", abbrev: "adra" },
    { name: "Adventist Mission (Handles Global Mission and Mission Offerings)", abbrev: "am" },
    { name: "Adventist Risk Management (ARM)", abbrev: "arm" },
    { name: "Ellen G. White Estate", abbrev: "egwe" },
    { name: "General Conference Auditing Service (GCAS)", abbrev: "gcas" }
];

async function seedOfficeUsers(name, shortName, roleId, parentBranch, hashedPassword) {
    // A. Insert President with temp username/branch
    const tempUsername = `temp_${roleId}_${Date.now()}_${Math.random()}`;
    const insertRes = await run(
        "INSERT INTO users (name, short_name, username, password, role_id, branch_code, position, department_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [name, shortName, tempUsername, hashedPassword, roleId, "TEMP", "President", null]
    );
    const presidentId = insertRes.id;
    const branchCode = `${parentBranch}.${presidentId}`;
    const username = branchCode.split('.').join('');

    // Update President's username and branch_code
    await run("UPDATE users SET branch_code = ?, username = ? WHERE id = ?", [branchCode, username, presidentId]);

    // B. Insert Secretary
    await run(
        "INSERT INTO users (name, short_name, username, password, role_id, branch_code, position, department_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [`${name} Secretary`, shortName, `${username}sec`, hashedPassword, roleId, branchCode, "Secretary", null]
    );

    // C. Insert Treasurer
    await run(
        "INSERT INTO users (name, short_name, username, password, role_id, branch_code, position, department_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [`${name} Treasurer`, shortName, `${username}treas`, hashedPassword, roleId, branchCode, "Treasurer", null]
    );

    // D. Insert 19 Departments
    for (const dept of DEPARTMENTS_INFO) {
        await run(
            "INSERT INTO users (name, short_name, username, password, role_id, branch_code, position, department_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [`${name} - ${dept.name}`, shortName, `${username}${dept.abbrev}`, hashedPassword, roleId, branchCode, "Department", dept.name]
        );
    }

    return { id: presidentId, branch: branchCode };
}

async function seedData() {
    try {
        console.log("Seeding database initial data...");
        
        // 1. Clear database completely
        await run("DELETE FROM users");
        await run("DELETE FROM subjects");
        await run("DELETE FROM departments");
        await run("DELETE FROM reports_teaching");
        await run("DELETE FROM reports_department");
        await run("DELETE FROM sqlite_sequence WHERE name IN ('users', 'subjects', 'departments', 'reports_teaching', 'reports_department')");
        
        const salt = bcrypt.genSaltSync(10);
        const hashedPassword = bcrypt.hashSync("password123", salt);

        // Begin transaction
        await run("BEGIN TRANSACTION");

        // 2. Seed Master User (role_id: 1, branch_code: '1')
        const seedMaster = await run(
            "INSERT INTO users (name, short_name, username, password, role_id, branch_code, position, department_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ["Master Admin", null, "master", hashedPassword, 1, "1", "President", null]
        );

        // Keep track of unique Divisions and Unions
        const divisionMap = new Map(); // cleanName -> { id, branch }
        const unionMap = new Map();    // cleanName -> { id, branch }
        
        // Parse CSV lines
        const lines = RAW_HIERARCHY_DATA.split('\n');
        
        // Skip header line (first line)
        let firstLine = true;
        let isFirstMC = true;
        let firstMCId = null;
        let firstMCBranch = null;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (firstLine) {
                firstLine = false;
                continue;
            }

            const parts = trimmed.split(';');
            if (parts.length < 3) continue;

            const divRaw = parts[0].trim();
            const unionRaw = parts[1].trim();
            const mcRaw = parts[2].trim();

            const divInfo = generateShortName(divRaw);
            const unionInfo = generateShortName(unionRaw);
            const mcInfo = generateShortName(mcRaw);

            // A. Insert Division if new
            let divDb = divisionMap.get(divInfo.name);
            if (!divDb) {
                divDb = await seedOfficeUsers(divInfo.name, divInfo.shortName, 2, "1", hashedPassword);
                divisionMap.set(divInfo.name, divDb);
            }

            // B. Insert Union if new
            const unionKey = `${divInfo.name} -> ${unionInfo.name}`;
            let unionDb = unionMap.get(unionKey);
            if (!unionDb) {
                unionDb = await seedOfficeUsers(unionInfo.name, unionInfo.shortName, 3, divDb.branch, hashedPassword);
                unionMap.set(unionKey, unionDb);
            }

            // C. Insert Mission / Conference
            const mcDb = await seedOfficeUsers(mcInfo.name, mcInfo.shortName, 4, unionDb.branch, hashedPassword);

            // Save the very first MC info for seeding testing Institution/Teacher
            if (isFirstMC) {
                isFirstMC = false;
                firstMCId = mcDb.id;
                firstMCBranch = mcDb.branch;
                
                // Seed default departments ONLY for the first MC (Central Sumatra Mission) to keep test counts correct
                const depts = ["Youth Ministries (YM)", "Education Department (EDU)", "Sabbath School and Personal Ministries (SSPM)"];
                for (const dept of depts) {
                    await run("INSERT INTO departments (mission_conference_id, department_name) VALUES (?, ?)", [firstMCId, dept]);
                }
            }
        }

        // D. Seed Default Test Institution & Teacher under the first MC to satisfy verify.js tests
        if (firstMCId && firstMCBranch) {
            // Seed Institution
            const seedInst = await run(
                "INSERT INTO users (name, short_name, username, password, role_id, branch_code, position, department_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                ["SMA Advent Martoba", "SMAM", "inst_temp", hashedPassword, 5, "TEMP", "President", null]
            );
            const instId = seedInst.id;
            const instBranch = `${firstMCBranch}.${instId}`;
            const instUsername = instBranch.split('.').join('');
            await run("UPDATE users SET branch_code = ?, username = ? WHERE id = ?", [instBranch, instUsername, instId]);

            // Seed Teacher
            const seedTeacher = await run(
                "INSERT INTO users (name, short_name, username, password, role_id, branch_code, position, department_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                ["Budi Santoso, S.Pd.", null, "teacher_temp", hashedPassword, 6, "TEMP", "Teacher", null]
            );
            const teacherId = seedTeacher.id;
            const teacherBranch = `${instBranch}.${teacherId}`;
            const teacherUsername = teacherBranch.split('.').join('');
            await run("UPDATE users SET branch_code = ?, username = ? WHERE id = ?", [teacherBranch, teacherUsername, teacherId]);

            // Seed subjects for the Teacher
            const subjects = ["Mathematics", "Physics", "Religion"];
            for (const sub of subjects) {
                await run("INSERT INTO subjects (teacher_id, subject_name) VALUES (?, ?)", [teacherId, sub]);
            }
        }

        await run("COMMIT");
        console.log("Database remade and seeded successfully with the ultimate list.");
    } catch (err) {
        await run("ROLLBACK");
        console.error("Error seeding data:", err);
        throw err;
    }
}

module.exports = {
    db,
    initDb,
    query,
    run,
    get
};
