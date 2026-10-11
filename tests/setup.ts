// Point the app's Prisma client at the test database before anything imports it.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
if (process.env.TEST_DIRECT_URL) process.env.DIRECT_URL = process.env.TEST_DIRECT_URL;
process.env.SESSION_SECRET ||= "test-secret-0123456789abcdef0123456789abcdef";
process.env.STORAGE_DIR ||= "./storage-test";
