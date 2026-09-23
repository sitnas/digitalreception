import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsEnum, IsIn, IsISO8601, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Role, VisitStatus } from '../entities';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class VisitQueryDto {
  @IsOptional() @IsUUID() siteId?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @IsEnum(VisitStatus) status?: VisitStatus;
  @IsOptional() @Transform(trim) @IsString() @Length(2, 190) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10_000) page?: number;
}

export const ERASE_REASONS = ['DATA_SUBJECT_REQUEST', 'ENTERED_BY_MISTAKE', 'DUPLICATE', 'OTHER'] as const;
export class EraseVisitDto {
  @IsIn(ERASE_REASONS) reason: (typeof ERASE_REASONS)[number];
  /** Reference to the privacy request ticket. Must not contain personal data. */
  @IsOptional() @Transform(trim) @IsString() @MaxLength(60) @Matches(/^[A-Za-z0-9_\-#/.]*$/) ticket?: string;
}

export class SiteQueryDto { @IsUUID() siteId: string }

export class CreateSiteDto {
  @Transform(({ value }) => String(value ?? '').trim().toUpperCase()) @Matches(/^[A-Z0-9-]{2,16}$/) code: string;
  @Transform(trim) @IsString() @Length(2, 120) name: string;
  @Matches(/^[A-Z]{2}$/) countryCode: string;
  @IsString() @Length(3, 64) timezone: string;
}

export class UpdateSiteDto {
  @IsOptional() @Transform(trim) @IsString() @Length(2, 120) name?: string;
  @IsOptional() @IsString() @Length(3, 64) timezone?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class PairingCodeDto {
  @IsUUID() siteId: string;
  @Transform(trim) @IsString() @Length(2, 80) name: string;
}

export class CreateUserDto {
  @Transform(({ value }) => String(value ?? '').trim().toLowerCase()) @IsEmail() @MaxLength(190) email: string;
  @Transform(trim) @IsString() @Length(2, 120) displayName: string;
  @IsEnum(Role) role: Role;
  @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) siteIds: string[];
  @IsString() @MinLength(12) @MaxLength(200) temporaryPassword: string;
}

export class UpdateUserDto {
  @IsOptional() @Transform(trim) @IsString() @Length(2, 120) displayName?: string;
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) siteIds?: string[];
  @IsOptional() @IsBoolean() active?: boolean;
}

const optionalText = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);
const HOST_NAME = /^[\p{L}\p{M}' .-]+$/u;

export class CreateHostDto {
  @Transform(trim) @IsString() @Length(1, 80) @Matches(HOST_NAME) firstName: string;
  @Transform(trim) @IsString() @Length(1, 80) @Matches(HOST_NAME) lastName: string;
  @IsOptional() @Transform(optionalText) @IsString() @MaxLength(120) department?: string | null;
  @IsOptional() @Transform(optionalText) @IsString() @MaxLength(120) jobTitle?: string | null;
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() || null : value)) @IsEmail() @MaxLength(190) email?: string | null;
  @IsOptional() @Transform(optionalText) @IsString() @MaxLength(40) @Matches(/^[0-9 +().\-/]*$/) phone?: string | null;
  @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) siteIds: string[];
}

export class UpdateHostDto {
  @IsOptional() @Transform(trim) @IsString() @Length(1, 80) @Matches(HOST_NAME) firstName?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 80) @Matches(HOST_NAME) lastName?: string;
  @IsOptional() @Transform(optionalText) @IsString() @MaxLength(120) department?: string | null;
  @IsOptional() @Transform(optionalText) @IsString() @MaxLength(120) jobTitle?: string | null;
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() || null : value)) @IsEmail() @MaxLength(190) email?: string | null;
  @IsOptional() @Transform(optionalText) @IsString() @MaxLength(40) @Matches(/^[0-9 +().\-/]*$/) phone?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) siteIds?: string[];
  @IsOptional() @IsBoolean() active?: boolean;
}

export class ResetPasswordDto { @IsString() @MinLength(12) @MaxLength(200) temporaryPassword: string }

export class UpdatePolicyDto {
  @IsOptional() @IsInt() @Min(1) @Max(3650) visitRetentionDays?: number;
  @IsOptional() @IsBoolean() documentDataEnabled?: boolean;
  @IsOptional() @IsBoolean() documentPhotoEnabled?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(365) documentPhotoRetentionDays?: number;
  @IsOptional() @IsBoolean() assetPhotosRequired?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(3650) assetPhotoRetentionDays?: number;
  @IsOptional() @IsArray() @IsIn(['it', 'es', 'en'], { each: true }) locales?: string[];
  @IsOptional() @IsIn(['it', 'es', 'en']) defaultLocale?: string;
}

export class CreateNoticeDto {
  @Matches(/^[A-Z]{2}$/) countryCode: string;
  @IsIn(['it', 'es', 'en']) locale: string;
  @Transform(trim) @IsString() @Length(3, 200) title: string;
  @IsString() @Length(50, 30_000) body: string;
}

export class AuditQueryDto {
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @IsString() @MaxLength(40) action?: string;
  @IsOptional() @IsString() @MaxLength(190) actor?: string;
  @IsOptional() @IsString() @MaxLength(36) entityId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10_000) page?: number;
}

export class AuditExportQueryDto {
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @IsString() @MaxLength(40) action?: string;
  @IsOptional() @IsString() @MaxLength(190) actor?: string;
  @IsOptional() @IsString() @MaxLength(36) entityId?: string;
}

export class CreatePolicyDto {
  @Matches(/^[A-Z]{2}$/) countryCode: string;
  @Transform(trim) @IsString() @Length(2, 80) name: string;
  @IsArray() @IsIn(['it', 'es', 'en'], { each: true }) locales: string[];
  @IsIn(['it', 'es', 'en']) defaultLocale: string;
  @IsInt() @Min(1) @Max(3650) visitRetentionDays: number;
}

export class UpdateOrganisationDto {
  @IsOptional() @Transform(trim) @IsString() @Length(2, 120) name?: string;
  /** PNG or JPEG data URL, max ~200 KB. SVG is refused (it can carry scripts). */
  @IsOptional() @IsString() @MaxLength(280_000) @Matches(/^(data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+)?$/) logoDataUrl?: string;
}
