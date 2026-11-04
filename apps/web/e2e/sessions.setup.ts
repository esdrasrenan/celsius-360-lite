import { expect, test as setup } from '@playwright/test'
import { PASSWORD, sessionFile, USERS, type User } from './support'

for (const user of Object.keys(USERS) as User[]) {
  setup(`sessão de ${user}`, async ({ request }) => {
    const response = await request.post('/api/v1/auth/login', {
      data: { email: USERS[user], password: PASSWORD },
    })
    expect(response.status(), `login de ${USERS[user]}`).toBe(200)
    await request.storageState({ path: sessionFile(user) })
  })
}
