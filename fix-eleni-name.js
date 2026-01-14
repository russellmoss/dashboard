const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    const updated = await prisma.user.update({
      where: { email: 'eleni@savvywealth.com' },
      data: { name: 'Eleni Stefanopoulos' }
    });
    console.log('Updated Eleni:', JSON.stringify(updated, null, 2));
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
})();
