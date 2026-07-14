import { Injectable } from "@nestjs/common";
import { randomInt } from "node:crypto";

const OTP_LENGTH = 6;
const OTP_EXCLUSIVE_UPPER_BOUND = 10 ** OTP_LENGTH;

/**
 * Generates cryptographically secure 6-digit OTP codes using Node's
 * `crypto.randomInt` (not `Math.random`, which is not
 * cryptographically secure). Hashing and storage of the generated code
 * live elsewhere (`PasswordHasherService` + `PendingRegistrationStore`)
 * — this service has exactly one responsibility: producing the code.
 */
@Injectable()
export class OtpService {
  generateCode(): string {
    const value = randomInt(0, OTP_EXCLUSIVE_UPPER_BOUND);
    return value.toString().padStart(OTP_LENGTH, "0");
  }
}
