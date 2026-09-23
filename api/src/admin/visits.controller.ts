import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AdminAuthGuard, CurrentUser, Roles } from '../common/guards';
import { AppRequest, AuthUser } from '../common/request-context';
import { Role } from '../entities';
import { EraseVisitDto, SiteQueryDto, VisitQueryDto } from './admin.dto';
import { VisitsService } from './visits.service';

const VISIT_READERS = [Role.SUPER_ADMIN, Role.SITE_MANAGER, Role.RECEPTIONIST];

@Controller('admin/visits')
@UseGuards(AdminAuthGuard)
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  @Get()
  @Roles(...VISIT_READERS)
  list(@CurrentUser() user: AuthUser, @Query() q: VisitQueryDto, @Req() req: AppRequest) {
    return this.visits.list(user, q, req);
  }

  @Get('present')
  @Roles(...VISIT_READERS)
  present(@CurrentUser() user: AuthUser, @Query() q: SiteQueryDto, @Req() req: AppRequest) {
    return this.visits.present(user, q.siteId, req);
  }

  @Get('export.csv')
  @Roles(Role.SUPER_ADMIN, Role.SITE_MANAGER)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async export(@CurrentUser() user: AuthUser, @Query() q: VisitQueryDto, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Content-Disposition', `attachment; filename="visits-${new Date().toISOString().slice(0, 10)}.csv"`);
    return this.visits.exportCsv(user, q, req);
  }

  @Get(':id')
  @Roles(...VISIT_READERS)
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    return this.visits.detail(user, id, req);
  }

  @Get(':id/files/:fileId')
  @Roles(Role.SUPER_ADMIN, Role.SITE_MANAGER)
  async file(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const f = await this.visits.file(user, id, fileId, req);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', 'inline');
    return new StreamableFile(f.data);
  }

  @Post(':id/checkout')
  @HttpCode(200)
  @Roles(...VISIT_READERS)
  checkout(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: AppRequest) {
    return this.visits.manualCheckout(user, id, req);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.SITE_MANAGER)
  erase(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EraseVisitDto, @Req() req: AppRequest) {
    return this.visits.erase(user, id, dto, req);
  }
}
