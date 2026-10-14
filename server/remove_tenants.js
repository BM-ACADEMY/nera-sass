const { connectMongo, mongoose } = require('./db/mongo');

async function run() {
  try {
    await connectMongo();
    const collections = await mongoose.connection.db.listCollections().toArray();
    for (const { name } of collections) {
      const result = await mongoose.connection.db.collection(name).updateMany(
        { tenant_id: { $exists: true } },
        { $unset: { tenant_id: '' } }
      );
      if (result.modifiedCount) console.log('Dropping tenant_id from ' + name);
    }

    await mongoose.connection.db.collection('tenants').drop().catch(() => {});
    console.log('Done DB clean');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

run();
