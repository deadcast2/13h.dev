import type { SourceFile } from "./turboc";

/**
 * The project a new visitor lands in.
 *
 * It is deliberately three files rather than one. A single hello-world would
 * demonstrate nothing that isn't already proven by the toolchain existing,
 * whereas this exercises the two things the rest of the project stands on: a
 * real mode 13h program — `<dos.h>`, the BIOS video interrupt, a far pointer to
 * A000:0000 — and a multi-file build where a header travels with the sources but
 * is not itself a translation unit.
 *
 * It doubles as the smoke test. Every pixel is `x ^ y`, so the result is
 * checkable against the default VGA palette rather than by eye: 320x200, 246
 * distinct colours, 61808 non-black pixels.
 */

const VGA_H: SourceFile = {
  name: "VGA.H",
  text: `#ifndef VGA_H
#define VGA_H

#define SCREEN_W 320
#define SCREEN_H 200

void set_mode(unsigned char mode);
void put_pixel(int x, int y, unsigned char color);

#endif
`,
};

const VGA_C: SourceFile = {
  name: "VGA.C",
  text: `#include <dos.h>
#include "VGA.H"

/* Mode 13h maps the whole 320x200 frame to one byte per pixel at A000:0000. */
unsigned char far *vga = (unsigned char far *)MK_FP(0xA000, 0x0000);

void set_mode(unsigned char mode)
{
    union REGS r;
    r.h.ah = 0x00;
    r.h.al = mode;
    int86(0x10, &r, &r);
}

void put_pixel(int x, int y, unsigned char color)
{
    vga[(unsigned int)y * SCREEN_W + x] = color;
}
`,
};

const MAIN_C: SourceFile = {
  name: "MAIN.C",
  text: `#include <conio.h>
#include "VGA.H"

int main(void)
{
    int x, y;

    set_mode(0x13);

    for (y = 0; y < SCREEN_H; y++)
        for (x = 0; x < SCREEN_W; x++)
            put_pixel(x, y, (unsigned char)(x ^ y));

    getch();
    set_mode(0x03);  /* back to text before handing the machine back */
    return 0;
}
`,
};

export const STARTER_PROJECT: SourceFile[] = [MAIN_C, VGA_C, VGA_H];
