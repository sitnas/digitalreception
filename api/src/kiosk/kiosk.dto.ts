import { Transform } from 'class-transformer';
import { Equals, IsBoolean, IsEmail, IsEnum, IsIn, IsOptional, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';
import { DocumentType, VisitPurpose } from '../entities';

export const SUPPORTED_LOCALES = ['it', 'es', 'en'] as const;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value);
const NAME = /^[\p{L}\p{M}' .-]+$/u;

export class PairDto {
  @IsString() @Transform(({ value }) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')) @Length(8, 8) code: string;
}

export class CheckInDto {
  @IsIn(SUPPORTED_LOCALES) locale: string;
  @Transform(trim) @IsString() @Length(1, 80) @Matches(NAME) firstName: string;
  @Transform(trim) @IsString() @Length(1, 80) @Matches(NAME) lastName: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) company?: string;
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() || undefined : value)) @IsEmail() @MaxLength(190) email?: string;
  @IsBoolean() sendNoticeEmail: boolean;
  @Transform(trim) @IsString() @Length(1, 120) host: string;
  @IsEnum(VisitPurpose) purpose: VisitPurpose;
  @IsOptional() @IsEnum(DocumentType) documentType?: DocumentType;
  @IsOptional() @Transform(trim) @IsString() @Length(3, 40) @Matches(/^[A-Za-z0-9 .\-/]+$/) documentNumber?: string;
  @IsUUID() privacyNoticeId: string;
  @Equals(true) privacyAccepted: boolean;
  @IsString() @MaxLength(5_000_000) signature: string;
  @IsOptional() @IsString() @MaxLength(5_000_000) documentPhoto?: string;
  @IsOptional() @IsString() @MaxLength(5_000_000) assetPhoto?: string;
}

export class OpenVisitsQuery {
  @Transform(trim) @IsString() @Length(2, 40) q: string;
}

export class CheckOutDto {
  @IsOptional() @IsString() @MaxLength(5_000_000) assetPhoto?: string;
}
