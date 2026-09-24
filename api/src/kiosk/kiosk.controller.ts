import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentDevice, CurrentTenant, DeviceGuard } from '../common/guards';
import { AppRequest, AuthDevice, AuthTenant } from '../common/request-context';
import { CheckInDto, CheckOutDto, OpenVisitsQuery, PairDto } from './kiosk.dto';
import { KioskService } from './kiosk.service';
import { InvitationsService } from '../invitations/invitations.service';

@Controller('kiosk')
export class KioskController {
  constructor(private readonly kiosk: KioskService, private readonly invitations: InvitationsService) {}

  /** Tablet enrolment with a one-time code generated in the admin console. */
  @Post('pair')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  pair(@CurrentTenant() tenant: AuthTenant, @Body() dto: PairDto, @Req() req: AppRequest) {
    return this.kiosk.pair(tenant, dto.code, req);
  }

  @Get('config')
  @UseGuards(DeviceGuard)
  config(@CurrentDevice() device: AuthDevice) {
    return this.kiosk.config(device);
  }

  @Post('visits')
  @UseGuards(DeviceGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  checkIn(@CurrentDevice() device: AuthDevice, @Body() dto: CheckInDto, @Req() req: AppRequest) {
    return this.kiosk.checkIn(device, dto, req);
  }

  /** Invitation scanned on arrival: the guest's details, to confirm instead of typing them. */
  @Get('invitations/:code')
  @UseGuards(DeviceGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  invitation(@CurrentDevice() device: AuthDevice, @Param('code') code: string) {
    return this.invitations.forKiosk(device, code.slice(0, 20));
  }

  @Get('visits/open')
  @UseGuards(DeviceGuard)
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  open(@CurrentDevice() device: AuthDevice, @Query() query: OpenVisitsQuery) {
    return this.kiosk.findOpen(device, query.q);
  }

  @Post('visits/:id/checkout')
  @HttpCode(200)
  @UseGuards(DeviceGuard)
  checkOut(@CurrentDevice() device: AuthDevice, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CheckOutDto, @Req() req: AppRequest) {
    return this.kiosk.checkOut(device, id, dto, req);
  }
}
