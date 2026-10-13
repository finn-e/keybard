import { describe, it, expect } from 'vitest';
import {
  endianFrom,
  LE16,
  LE32,
  BE16,
  BE32,
  convArrayEndian,
  range,
  repeat
} from '../../src/services/utils';

describe('Utils - Byte Manipulation', () => {
  describe('endianFrom', () => {
    it('should convert number to little-endian 2-byte array', () => {
      // Arrange
      const num = 0x1234;
      const bytes = 2;
      const little = true;

      // Act
      const result = endianFrom(num, bytes, little);

      // Assert
      expect(result).toEqual([0x34, 0x12]);
    });

    it('should convert number to big-endian 2-byte array', () => {
      // Arrange
      const num = 0x1234;
      const bytes = 2;
      const little = false;

      // Act
      const result = endianFrom(num, bytes, little);

      // Assert
      expect(result).toEqual([0x12, 0x34]);
    });

    it('should convert number to little-endian 4-byte array', () => {
      // Arrange
      const num = 0x12345678;
      const bytes = 4;
      const little = true;

      // Act
      const result = endianFrom(num, bytes, little);

      // Assert
      expect(result).toEqual([0x78, 0x56, 0x34, 0x12]);
    });

    it('should convert number to big-endian 4-byte array', () => {
      // Arrange
      const num = 0x12345678;
      const bytes = 4;
      const little = false;

      // Act
      const result = endianFrom(num, bytes, little);

      // Assert
      expect(result).toEqual([0x12, 0x34, 0x56, 0x78]);
    });
  });

  describe('LE16', () => {
    it('should convert 0x0000 to little-endian', () => {
      // Arrange
      const num = 0x0000;

      // Act
      const result = LE16(num);

      // Assert
      expect(result).toEqual([0x00, 0x00]);
    });

    it('should convert 0xFFFF to little-endian', () => {
      // Arrange
      const num = 0xFFFF;

      // Act
      const result = LE16(num);

      // Assert
      expect(result).toEqual([0xFF, 0xFF]);
    });

    it('should convert 0x1234 to little-endian', () => {
      // Arrange
      const num = 0x1234;

      // Act
      const result = LE16(num);

      // Assert
      expect(result).toEqual([0x34, 0x12]);
    });

    it('should handle negative numbers correctly', () => {
      // Arrange
      const num = -1;

      // Act
      const result = LE16(num);

      // Assert
      expect(result).toEqual([0xFF, 0xFF]);
    });
  });

  describe('BE16', () => {
    it('should convert 0x0000 to big-endian', () => {
      // Arrange
      const num = 0x0000;

      // Act
      const result = BE16(num);

      // Assert
      expect(result).toEqual([0x00, 0x00]);
    });

    it('should convert 0xFFFF to big-endian', () => {
      // Arrange
      const num = 0xFFFF;

      // Act
      const result = BE16(num);

      // Assert
      expect(result).toEqual([0xFF, 0xFF]);
    });

    it('should convert 0x1234 to big-endian', () => {
      // Arrange
      const num = 0x1234;

      // Act
      const result = BE16(num);

      // Assert
      expect(result).toEqual([0x12, 0x34]);
    });

    it('should produce different output than LE16 for non-symmetric values', () => {
      // Arrange
      const num = 0x1234;

      // Act
      const leResult = LE16(num);
      const beResult = BE16(num);

      // Assert
      expect(leResult).not.toEqual(beResult);
      expect(leResult).toEqual([0x34, 0x12]);
      expect(beResult).toEqual([0x12, 0x34]);
    });
  });

  describe('LE32', () => {
    it('should convert 0x00000000 to little-endian', () => {
      // Arrange
      const num = 0x00000000;

      // Act
      const result = LE32(num);

      // Assert
      expect(result).toEqual([0x00, 0x00, 0x00, 0x00]);
    });

    it('should convert 0xFFFFFFFF to little-endian', () => {
      // Arrange
      const num = 0xFFFFFFFF;

      // Act
      const result = LE32(num);

      // Assert
      expect(result).toEqual([0xFF, 0xFF, 0xFF, 0xFF]);
    });

    it('should convert 0x12345678 to little-endian', () => {
      // Arrange
      const num = 0x12345678;

      // Act
      const result = LE32(num);

      // Assert
      expect(result).toEqual([0x78, 0x56, 0x34, 0x12]);
    });
  });

  describe('BE32', () => {
    it('should convert 0x00000000 to big-endian', () => {
      // Arrange
      const num = 0x00000000;

      // Act
      const result = BE32(num);

      // Assert
      expect(result).toEqual([0x00, 0x00, 0x00, 0x00]);
    });

    it('should convert 0xFFFFFFFF to big-endian', () => {
      // Arrange
      const num = 0xFFFFFFFF;

      // Act
      const result = BE32(num);

      // Assert
      expect(result).toEqual([0xFF, 0xFF, 0xFF, 0xFF]);
    });

    it('should convert 0x12345678 to big-endian', () => {
      // Arrange
      const num = 0x12345678;

      // Act
      const result = BE32(num);

      // Assert
      expect(result).toEqual([0x12, 0x34, 0x56, 0x78]);
    });

    it('should produce different output than LE32 for non-symmetric values', () => {
      // Arrange
      const num = 0x12345678;

      // Act
      const leResult = LE32(num);
      const beResult = BE32(num);

      // Assert
      expect(leResult).not.toEqual(beResult);
      expect(leResult).toEqual([0x78, 0x56, 0x34, 0x12]);
      expect(beResult).toEqual([0x12, 0x34, 0x56, 0x78]);
    });
  });

  describe('convArrayEndian', () => {
    it('should convert 16-bit array elements endianness', () => {
      // Arrange
      const ary = [0x1234, 0x5678, 0xABCD];
      const size = 2;

      // Act
      const result = convArrayEndian(ary, size);

      // Assert
      expect(result).toEqual([0x3412, 0x7856, 0xCDAB]);
    });

    it('should convert 32-bit array elements endianness', () => {
      // Arrange
      const ary = [0x12345678, 0xABCDEF00];
      const size = 4;

      // Act
      const result = convArrayEndian(ary, size);

      // Assert
      expect(result).toEqual([0x78563412, 0x00EFCDAB]);
    });

    it('should handle empty array', () => {
      // Arrange
      const ary: number[] = [];
      const size = 2;

      // Act
      const result = convArrayEndian(ary, size);

      // Assert
      expect(result).toEqual([]);
    });

    it('should handle array with single element', () => {
      // Arrange
      const ary = [0x1234];
      const size = 2;

      // Act
      const result = convArrayEndian(ary, size);

      // Assert
      expect(result).toEqual([0x3412]);
    });
  });

  describe('range', () => {
    it('should create array from 0 to n-1', () => {
      // Arrange
      const num = 5;

      // Act
      const result = range(num);

      // Assert
      expect(result).toEqual([0, 1, 2, 3, 4]);
    });

    it('should return empty array for 0', () => {
      // Arrange
      const num = 0;

      // Act
      const result = range(num);

      // Assert
      expect(result).toEqual([]);
    });

    it('should handle large numbers', () => {
      // Arrange
      const num = 100;

      // Act
      const result = range(num);

      // Assert
      expect(result).toHaveLength(100);
      expect(result[0]).toBe(0);
      expect(result[99]).toBe(99);
    });
  });

  describe('repeat', () => {
    it('should repeat primitive value n times', () => {
      // Arrange
      const what = 'A';
      const count = 5;

      // Act
      const result = repeat(what, count);

      // Assert
      expect(result).toEqual(['A', 'A', 'A', 'A', 'A']);
    });

    it('should repeat number n times', () => {
      // Arrange
      const what = 42;
      const count = 3;

      // Act
      const result = repeat(what, count);

      // Assert
      expect(result).toEqual([42, 42, 42]);
    });

    it('should repeat object reference n times', () => {
      // Arrange
      const what = { key: 'value' };
      const count = 2;

      // Act
      const result = repeat(what, count);

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0]).toBe(result[1]); // Same reference
      expect(result[0]).toEqual({ key: 'value' });
    });

    it('should return empty array for count 0', () => {
      // Arrange
      const what = 'test';
      const count = 0;

      // Act
      const result = repeat(what, count);

      // Assert
      expect(result).toEqual([]);
    });

    it('should handle null and undefined', () => {
      // Arrange & Act
      const nullResult = repeat(null, 3);
      const undefinedResult = repeat(undefined, 2);

      // Assert
      expect(nullResult).toEqual([null, null, null]);
      expect(undefinedResult).toEqual([undefined, undefined]);
    });
  });

  // Edge cases and boundary tests
  describe('Edge cases', () => {
    it('LE16 should handle maximum signed 16-bit integer', () => {
      // Arrange
      const num = 32767; // 0x7FFF

      // Act
      const result = LE16(num);

      // Assert
      expect(result).toEqual([0xFF, 0x7F]);
    });

    it('LE16 should handle minimum signed 16-bit integer', () => {
      // Arrange
      const num = -32768; // 0x8000

      // Act
      const result = LE16(num);

      // Assert
      expect(result).toEqual([0x00, 0x80]);
    });

    it('LE32 should handle maximum signed 32-bit integer', () => {
      // Arrange
      const num = 2147483647; // 0x7FFFFFFF

      // Act
      const result = LE32(num);

      // Assert
      expect(result).toEqual([0xFF, 0xFF, 0xFF, 0x7F]);
    });

    it('convArrayEndian should be reversible', () => {
      // Arrange
      const original = [0x1234, 0x5678];
      const size = 2;

      // Act
      const converted = convArrayEndian(original, size);
      const reversed = convArrayEndian(converted, size);

      // Assert
      expect(reversed).toEqual(original);
    });

    it('range should handle negative numbers gracefully', () => {
      // Arrange
      const num = -5;

      // Act
      const result = range(num);

      // Assert
      expect(result).toEqual([]);
    });
  });
});