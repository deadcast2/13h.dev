import type { SourceFile } from "./turboc";

/**
 * The project a new visitor lands in.
 *
 * It is deliberately three files rather than one. A single hello-world would
 * demonstrate nothing that isn't already proven by the toolchain existing,
 * whereas this exercises everything the rest of the project stands on: a real
 * mode 13h program — `<dos.h>`, the BIOS video interrupt, a far pointer to
 * A000:0000 — a multi-file build where a header travels with the sources but is
 * not itself a translation unit, and, so the very first Build is motion rather
 * than a still, an animation loop paced to the CRT's own retrace.
 *
 * It doubles as the smoke test. The animation is the XOR pattern with a value
 * that climbs one step per frame, and at t=0 — the first frame drawn — every
 * pixel is `x ^ y` exactly as a static version would be: 320x200, 246 distinct
 * colours, 61808 non-black pixels, all checkable against the default VGA palette
 * rather than by eye. Adding a constant to every pixel is a bijection on the
 * palette index, so the 246-distinct-colours count holds on every later frame
 * too; only which pixels land on black, and thus the non-black count, moves.
 */

const VGA_H: SourceFile = {
  name: "VGA.H",
  text: `#ifndef VGA_H
#define VGA_H

#define SCREEN_W 320
#define SCREEN_H 200

void set_mode(unsigned char mode);
void put_pixel(int x, int y, unsigned char color);
void wait_vsync(void);

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

/*
 * Block until the CRT begins its next vertical retrace. Bit 3 of the input
 * status register at port 0x3DA is set while the electron beam is travelling
 * back up to the top of the screen and drawing nothing; waiting for that moment
 * paces the animation to mode 13h's native ~70 frames a second instead of
 * letting it run as fast as the machine can, and is the classic way a DOS game
 * kept its motion smooth.
 */
void wait_vsync(void)
{
    while (inportb(0x3DA) & 0x08)
        ;   /* if a retrace is already under way, let it finish */
    while (!(inportb(0x3DA) & 0x08))
        ;   /* then wait for the next one to begin */
}
`,
};

const MAIN_C: SourceFile = {
  name: "MAIN.C",
  text: `#include <conio.h>
#include "VGA.H"

/*
 * The XOR pattern, set in motion. Every pixel's colour is (x ^ y) plus an offset
 * that climbs one step per frame, so the diagonal interference bands slide
 * through the palette and the whole screen shimmers. The offset is an unsigned
 * char, so it wraps from 255 back to 0 on its own and the motion never ends.
 *
 * Press any key to stop.
 */
int main(void)
{
    int x, y;
    unsigned char t = 0;

    set_mode(0x13);

    while (!kbhit())
    {
        for (y = 0; y < SCREEN_H; y++)
            for (x = 0; x < SCREEN_W; x++)
                put_pixel(x, y, (unsigned char)((x ^ y) + t));

        wait_vsync();
        t++;
    }

    getch();         /* swallow the key that stopped the loop */
    set_mode(0x03);  /* back to text before handing the machine back */
    return 0;
}
`,
};

export const STARTER_PROJECT: SourceFile[] = [MAIN_C, VGA_C, VGA_H];

/**
 * What a project created from scratch starts with. One self-contained file
 * rather than a copy of the starter — someone making a second project has seen
 * the tour already — but still a program that builds and draws, so Build works
 * before anything has been typed.
 *
 * The cast in the offset calculation is the point of the exercise, not noise:
 * `y * 320` overflows a 16-bit `int` from y=103 onwards, and the resulting
 * garbage on screen is one of the first things mode 13h teaches you.
 */
export const NEW_PROJECT: SourceFile[] = [
  {
    name: "MAIN.C",
    text: `#include <dos.h>
#include <conio.h>

unsigned char far *vga = (unsigned char far *)MK_FP(0xA000, 0x0000);

void set_mode(unsigned char mode)
{
    union REGS r;
    r.h.ah = 0x00;
    r.h.al = mode;
    int86(0x10, &r, &r);
}

int main(void)
{
    int x, y;

    set_mode(0x13);

    for (y = 0; y < 200; y++)
        for (x = 0; x < 320; x++)
            vga[(unsigned int)y * 320 + x] = (unsigned char)(y >> 3);

    getch();
    set_mode(0x03);
    return 0;
}
`,
  },
];
