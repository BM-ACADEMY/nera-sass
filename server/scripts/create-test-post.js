require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { connectMongo, mongoose } = require('../db/connection');
const { ContentQueue } = require('../models');

async function createTestPost() {
  console.log('Inserting test post for BM TechX...');

  try {
    await connectMongo();
    const post = await ContentQueue.create({
      brand_name: 'BM TechX',
      file_name: 'test-reel.mp4',
      video_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
      caption: 'Testing automated Content OS publishing! 🚀 #automation #meta #leados',
      platforms: ['facebook', 'instagram'],
      status: 'APPROVED',
      created_at: new Date(),
      updated_at: new Date(),
    });
    console.log(`\n🎉 Test post created successfully!`);
    console.log(`Post ID: ${post.id}`);
    console.log(`Brand: BM TechX`);
    console.log(`Platforms: Facebook & Instagram`);
    console.log(`Status: APPROVED`);
    console.log(`\nTo publish this post immediately, you can trigger it via API:`);
    console.log(`POST http://localhost:5000/api/content/${post.id}/publish`);
  } catch (err) {
    console.error('Failed to create test post:', err);
  } finally {
    await mongoose.disconnect();
  }
}

createTestPost();
