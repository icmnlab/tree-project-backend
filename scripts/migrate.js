const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const copyFrom = require('pg-copy-streams').from; // Import the helper correctly
const { Transform } = require('stream'); // Add Transform stream
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Define the correct order for table creation
const migrationFiles = [
  '00_init_functions.pg.sql', // Initialize shared functions first
  'users.pg.sql',
  'system_settings_and_audit.pg.sql', // [New] System settings and Audit logs
  'project_areas.pg.sql',
  'tree_species.pg.sql',
  'species_region_score.pg.sql',
  'tree_carbon_data.pg.sql',
  'tree_survey.pg.sql', // Structure only
  '00_normalization_schema.pg.sql', // [Moved] Run AFTER tree_survey is created
  'tree_management_actions.pg.sql',
  'chat_logs.pg.sql', // 新增 chat_logs 表格
  '02_chat_logs_add_session.pg.sql', // [New] 加入 session_id 欄位支援多會話
  '04_chat_logs_agent_mode.pg.sql', // [New] Agent 模式支援 (chat_mode + metadata)
  'tree_knowledge_embeddings_v2.pg.sql', // 新增 AI 知識庫表格
  '01_sync_project_id_trigger.sql', // [New] Project ID synchronization trigger
  'ml_training_data.pg.sql', // ML 訓練數據表
  'emission_factors.pg.sql', // 排放因子表
  'z_pending_tree_measurements.pg.sql', // [New] 待測量樹木資料表 - 兩階段測量工作流程 (z_ 確保最後執行)
  'tree_images.pg.sql', // [New] 樹木影像資料表 - 關聯到 tree_survey 與 pending_measurements
  'species_synonyms.pg.sql', // [New] 樹種同義詞/名稱變體對照表 - 統一不同量測員的命名差異
  '03_user_projects.pg.sql', // [Phase A] user_projects junction table + 從 associated_projects 遷移 + 填充 projects 表
  '05_ip_blacklist.pg.sql', // [T8.2] IP 黑名單與登入失敗計數
  '06_project_boundaries_seed.pg.sql', // [Data] 35 個港務專案邊界 (convex hull from tree GPS, +10m buffer)
  '07_backfill_projects_area_id.pg.sql', // [Heal] Backfill projects.area_id from project_location + heal placeholder names
  '08_text_integrity_check.pg.sql' // [L3] 禁止 U+FFFD 寫入關鍵字串欄位 (見 utils/textValidation.js)
];

// Define the order for view creation
const viewFiles = [
    'tree_survey_with_areas.pg.sql'
];

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Starting database migration...');

    // Execute migration files for table creation and data insertion
    for (const file of migrationFiles) {
      console.log(`Executing ${file}...`);
      const filePath = path.join(__dirname, '../database/initial_data', file);
      const script = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
      await client.query(script);
      console.log(`${file} executed successfully.`);
    }

    // Import data from CSV into tree_survey table
    console.log('Importing data from tree_survey_data.csv...');
    const csvPath = path.join(__dirname, '../database/initial_data', 'tree_survey_data.csv');
    if (fs.existsSync(csvPath)) {
        // Use COPY for high performance, requires absolute path on server
        // We need to resolve the full path for the COPY command
        const absolutePath = path.resolve(csvPath);
        
        // Note: COPY requires superuser privileges in PostgreSQL. 
        // Render's managed PostgreSQL might not grant this.
        // A more compatible way might be to parse CSV and build INSERT statements,
        // but it's much slower. We'll try with COPY first.
        
        // We read the header to map columns correctly
        const csvData = fs.readFileSync(csvPath, 'utf8');
        const records = parse(csvData, { columns: true, skip_empty_lines: true });
        const header = Object.keys(records[0]).map(h => `"${h}"`).join(', ');

        const copyCommand = `COPY tree_survey(${header}) FROM STDIN WITH (FORMAT CSV, HEADER, FORCE_NULL(survey_time, tree_height_m, dbh_cm, x_coord, y_coord, carbon_storage, carbon_sequestration_per_year))`;
        
        // Use the copyFrom helper to create a writable stream
        const stream = client.query(copyFrom(copyCommand));
        const fileStream = fs.createReadStream(absolutePath);

        // Create a transform stream to replace invalid dates on the fly.
        //
        // CRITICAL: We MUST operate on Buffer bytes, not strings.
        // Previously this used `chunk.toString()` (default UTF-8) which splits
        // 3-byte CJK characters across chunk boundaries → silently injects
        // U+FFFD (EF BF BD) into the data. That bug populated dirty rows like
        // "台中港植栽第??區" on every deploy.
        // The replacement target "0000-00-00 00:00:00" is pure ASCII, so it is
        // safe to do at byte level — no UTF-8 awareness required.
        const INVALID_DATE = Buffer.from('0000-00-00 00:00:00', 'ascii');
        // Keep the trailing (needle.length - 1) bytes of each chunk in a
        // residual so the needle can match across chunk boundaries.
        let residual = Buffer.alloc(0);
        const transformStream = new Transform({
          transform(chunk, encoding, callback) {
            try {
              const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              const combined = residual.length > 0 ? Buffer.concat([residual, buf]) : buf;
              const keep = INVALID_DATE.length - 1;
              const cutoff = combined.length > keep ? combined.length - keep : 0;
              const processable = combined.subarray(0, cutoff);
              residual = combined.subarray(cutoff);

              if (processable.indexOf(INVALID_DATE) === -1) {
                this.push(processable);
              } else {
                let start = 0;
                let idx;
                const parts = [];
                while ((idx = processable.indexOf(INVALID_DATE, start)) !== -1) {
                  parts.push(processable.subarray(start, idx));
                  start = idx + INVALID_DATE.length;
                }
                parts.push(processable.subarray(start));
                this.push(Buffer.concat(parts));
              }
              callback();
            } catch (err) {
              callback(err);
            }
          },
          flush(callback) {
            try {
              // Flush remaining residual at end-of-stream.
              if (residual.length > 0) {
                if (residual.indexOf(INVALID_DATE) === -1) {
                  this.push(residual);
                } else {
                  let start = 0;
                  let idx;
                  const parts = [];
                  while ((idx = residual.indexOf(INVALID_DATE, start)) !== -1) {
                    parts.push(residual.subarray(start, idx));
                    start = idx + INVALID_DATE.length;
                  }
                  parts.push(residual.subarray(start));
                  this.push(Buffer.concat(parts));
                }
              }
              callback();
            } catch (err) {
              callback(err);
            }
          }
        });

        await new Promise((resolve, reject) => {
            fileStream.on('error', reject);
            transformStream.on('error', reject); // Handle errors on the new stream
            stream.on('error', reject);
            stream.on('finish', resolve);
            fileStream.pipe(transformStream).pipe(stream);
        });

        console.log('tree_survey_data.csv imported successfully.');
    } else {
      console.log('tree_survey_data.csv not found, skipping import.');
    }
    
    // After all tables are created and data is imported, create the views
    for (const file of viewFiles) {
        console.log(`Executing view creation script ${file}...`);
        const filePath = path.join(__dirname, '../database/initial_data', file);
        const script = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
        await client.query(script);
        console.log(`${file} executed successfully.`);
    }

    // [FIX] Reset the primary key sequence for tree_survey table
    console.log('Resetting the primary key sequence for tree_survey...');
    await client.query(`SELECT setval(pg_get_serial_sequence('tree_survey', 'id'), COALESCE(MAX(id), 1), true) FROM tree_survey;`);

    // [2025.11 優化] 移除不再需要的 RAG 相關腳本
    // 現在使用 Text-to-SQL 架構，不需要 embedding 和知識庫
    // 以下腳本已停用：
    // - populate_knowledge (RAG 知識庫)
    // - generateEmbeddings (向量嵌入)
    // - enrich_species_synonyms (AI 同義詞擴充)
    
    // 只保留 species_region_score，因為這是統計數據，對報表有用
    const populateScores = require('./populateSpeciesRegionScore');

    console.log('Sequence reset successfully.');

    try {
        console.log('Calculating/Populating species region scores...');
        await populateScores();
        console.log('Species region scores populated successfully.');
    } catch (kErr) {
        console.error('Warning: Species region score population failed, but continuing:', kErr.message);
    }

    console.log('Database migration completed successfully!');
  } catch (error) {
    console.error('Error during database migration:', error);
    process.exit(1); // Exit with an error code
  } finally {
    client.release();
    // pool.end(); // Don't end the pool here if we want to reuse it or if app.js handles DB connections
    // But since migrate.js uses its own pool, we should end it.
    // ideally, migrate should accept a client or pool.
    await pool.end();
  }
}

// Allow running directly or importing
if (require.main === module) {
migrate();
}

module.exports = migrate;
