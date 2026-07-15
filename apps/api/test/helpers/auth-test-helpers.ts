import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { FakeMailService } from "./fake-mail.service";

/** Finds the most recently sent 6-digit code emailed to `to`, exactly as a person would read it out of their inbox. */
export function extractOtpFor(mail: FakeMailService, to: string): string {
  const sent = [...mail.sentEmails].reverse().find((m) => m.to === to);
  expect(sent).toBeDefined();
  const match = sent?.text.match(/\d{6}/);
  expect(match).toBeTruthy();
  return match?.[0] as string;
}

/** Registers and fully verifies a user against `app`, so a test that needs an existing verified account doesn't have to depend on another test's account or ordering. */
export async function registerAndVerifyUser(
  app: INestApplication,
  mail: FakeMailService,
  email: string,
  password: string,
  name: string,
): Promise<void> {
  await request(app.getHttpServer())
    .post("/auth/register")
    .send({ email, password, name })
    .expect(202);
  const otp = extractOtpFor(mail, email);
  await request(app.getHttpServer()).post("/auth/verify-otp").send({ email, otp }).expect(201);
}

/** Registers, verifies, and logs a fresh user in against `app`, returning the access token a test needs to call a protected route. */
export async function registerVerifyAndLogin(
  app: INestApplication,
  mail: FakeMailService,
  email: string,
  password: string,
  name: string,
): Promise<string> {
  await registerAndVerifyUser(app, mail, email, password, name);

  const loginResponse = await request(app.getHttpServer())
    .post("/auth/login")
    .send({ email, password })
    .expect(200);

  return loginResponse.body.data.accessToken as string;
}
