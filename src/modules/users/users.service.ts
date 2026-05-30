import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async create(data: { email: string; password: string; firstName?: string; lastName?: string }) {
    const exists = await this.findByEmail(data.email);
    if (exists) throw new ConflictException('Email already in use');
    const hashed = await bcrypt.hash(data.password, 12);
    return this.prisma.user.create({
      data: { ...data, password: hashed },
    });
  }

  async getProfile(id: string) {
    const user = await this.findById(id);
    const { password, ...profile } = user;
    return profile;
  }

  async deactivate(id: string) {
    await this.prisma.user.update({ where: { id }, data: { isActive: false } });
    await this.redis.setBanned(id);
  }

  async reactivate(id: string) {
    await this.prisma.user.update({ where: { id }, data: { isActive: true } });
    await this.redis.deleteBanned(id);
  }
}
