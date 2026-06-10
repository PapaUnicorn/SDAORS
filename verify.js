const dbHelper = require('./db');
const bcrypt = require('bcryptjs');

async function testBackend() {
    console.log("Starting backend verification test...");
    
    // Initialize Database
    try {
        await dbHelper.initDb();
        console.log("[PASS] Database initialized and seeded successfully.");
    } catch (err) {
        console.error("[FAIL] Database initialization failed:", err);
        process.exit(1);
    }

    // Verify Master User was seeded
    try {
        const master = await dbHelper.get("SELECT * FROM users WHERE role_id = 1 AND username = 'master'");
        if (!master) throw new Error("Master user not found in DB.");
        
        const isMatch = bcrypt.compareSync("password123", master.password);
        if (!isMatch) throw new Error("Master password mismatch.");
        
        console.log("[PASS] Master user verified. Password hashed correctly.");
        console.log("Master Info:", { id: master.id, name: master.name, branch_code: master.branch_code });
    } catch (err) {
        console.error("[FAIL] Master user verification failed:", err.message);
        process.exit(1);
    }

    // Verify Hierarchy lineage tracking
    try {
        const teacher = await dbHelper.get("SELECT * FROM users WHERE role_id = 6 LIMIT 1");
        if (!teacher) throw new Error("Teacher user not found in DB.");
        
        console.log("[PASS] Teacher user verified. Lineage Path:", teacher.branch_code);
        
        // Verify subjects assigned to teacher
        const subjects = await dbHelper.query("SELECT * FROM subjects WHERE teacher_id = ?", [teacher.id]);
        console.log("[PASS] Teacher subjects verification: Found", subjects.length, "assigned subjects.");
        console.log("Subjects List:", subjects.map(s => s.subject_name));
        
        if (subjects.length !== 3) throw new Error("Teacher should have exactly 3 subjects assigned.");
    } catch (err) {
        console.error("[FAIL] Lineage / assigned subjects test failed:", err.message);
        process.exit(1);
    }

    // Verify stats calculations
    try {
        const term = '2026-06';
        const subjectsData = await dbHelper.query(
            `SELECT s.id, s.subject_name, s.teacher_id, COALESCE(r.status, 'Not Submitted') as status
             FROM subjects s
             LEFT JOIN reports_teaching r ON r.user_id = s.teacher_id AND r.subject_name = s.subject_name AND r.term = ?`,
            [term]
        );
        
        const deptsData = await dbHelper.query(
            `SELECT d.id, d.department_name, d.mission_conference_id, COALESCE(r.status, 'Not Submitted') as status
             FROM departments d
             LEFT JOIN reports_department r ON r.user_id = d.mission_conference_id AND r.department_name = d.department_name AND r.term = ?`,
            [term]
        );
        
        const allItems = [...subjectsData, ...deptsData];
        const totalTarget = allItems.length;
        const approvedCount = allItems.filter(x => x.status === 'Approved').length;
        const pendingCount = allItems.length - approvedCount;
        
        console.log("[PASS] Dashboard Stats calculation verification:");
        console.log("Metrics:", { totalTarget, approved: approvedCount, notSubmitted: pendingCount });
        
        if (totalTarget !== 6) throw new Error("Total target should be 6 (3 teacher subjects + 3 MC departments)");
    } catch (err) {
        console.error("[FAIL] Statistics calculations failed:", err.message);
        process.exit(1);
    }

    console.log("\n[SUCCESS] All backend business logic tests passed successfully!");
    dbHelper.db.close();
}

testBackend();
