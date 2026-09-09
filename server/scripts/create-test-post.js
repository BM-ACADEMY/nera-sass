const pool = require('../db/connection');

async function createTestPost() {
  console.log('Inserting test post for BM TechX...');

  const query = `
    INSERT INTO content_queue (
      brand_name, file_name, video_url, caption, platforms, status, created_at, updated_at
    ) VALUES (
      'BM TechX', 
      'test-reel.mp4', 
      'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4', 
      'Testing automated Content OS publishing! 🚀 #automation #meta #leados', 
      '["facebook", "instagram"]'::jsonb, 
      'APPROVED', 
      NOW(), 
      NOW()
    ) RETURNING id;
  `;

  try {
    const { rows } = await pool.query(query);
    console.log(`\n🎉 Test post created successfully!`);
    console.log(`Post ID: ${rows[0].id}`);
    console.log(`Brand: BM TechX`);
    console.log(`Platforms: Facebook & Instagram`);
    console.log(`Status: APPROVED`);
    console.log(`\nTo publish this post immediately, you can trigger it via API:`);
    console.log(`POST http://localhost:5000/api/content/${rows[0].id}/publish`);
  } catch (err) {
    console.error('Failed to create test post:', err);
  } finally {
    await pool.end();
  }
}

createTestPost();
