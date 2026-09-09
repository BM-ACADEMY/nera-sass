const pool = require('../../db/connection');

async function ensureTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS citation_scans (
        id SERIAL PRIMARY KEY,
        "businessId" INTEGER REFERENCES mafiya_gmb_clients(id) ON DELETE CASCADE,
        score INTEGER,
        "lastScan" TIMESTAMP DEFAULT NOW(),
        "totalDirectories" INTEGER,
        matched INTEGER,
        mismatched INTEGER,
        missing INTEGER,
        "debugData" JSONB
      )
    `);

    // Backfill for tables created before this column existed.
    await pool.query(`
      ALTER TABLE citation_scans ADD COLUMN IF NOT EXISTS "debugData" JSONB
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS citation_results (
        id SERIAL PRIMARY KEY,
        "scanId" INTEGER REFERENCES citation_scans(id) ON DELETE CASCADE,
        directory VARCHAR(255),
        "listingUrl" TEXT,
        "businessName" VARCHAR(255),
        phone VARCHAR(50),
        address TEXT,
        website VARCHAR(500),
        status VARCHAR(50), -- Match, Mismatch, Missing, Pending
        confidence INTEGER,
        "checkedAt" TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS api_usage_logs (
        id SERIAL PRIMARY KEY,
        provider VARCHAR(50) DEFAULT 'valueserp',
        client_id INTEGER REFERENCES mafiya_gmb_clients(id) ON DELETE SET NULL,
        client_name VARCHAR(255),
        search_query TEXT,
        directory VARCHAR(100),
        credits_consumed INTEGER DEFAULT 1,
        request_time TIMESTAMP DEFAULT NOW(),
        response_status VARCHAR(50) DEFAULT '200',
        scan_duration_ms INTEGER DEFAULT 0,
        is_cached BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS client_directory_cache (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES mafiya_gmb_clients(id) ON DELETE CASCADE,
        directory VARCHAR(100) NOT NULL,
        listing_url TEXT,
        business_name VARCHAR(255),
        address TEXT,
        phone VARCHAR(50),
        website VARCHAR(500),
        status VARCHAR(50),
        last_scraped_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(client_id, directory)
      )
    `);

    console.log('✅ Mafiya Citation & Usage tables checked/created successfully.');
  } catch (err) {
    console.error('❌ Failed to ensure Mafiya citation tables:', err);
  }
}

module.exports = { ensureTables };
