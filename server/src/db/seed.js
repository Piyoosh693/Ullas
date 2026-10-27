const seedData = {
  users: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'admin@ullas.local',
      password_hash: 'hashed-admin-password',
      role: 'admin',
      status: 'active',
      email_verified: true,
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      email: 'professional@ullas.local',
      password_hash: 'hashed-professional-password',
      role: 'professional',
      status: 'active',
      email_verified: true,
    },
  ],
  organizations: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      owner_user_id: '22222222-2222-4222-8222-222222222222',
      name: 'Roorkee Learning Circle',
      slug: 'roorkee-learning-circle',
      description: 'Community learning organization',
      verification_status: 'approved',
    },
  ],
};

module.exports = { seedData };
