import type { SourceFile } from "./turboc";

/**
 * The smoke-test program. It is deliberately a real mode 13h program rather than
 * a hello-world: it exercises `<dos.h>`, the BIOS video interrupt, and a far
 * pointer into video memory at A000:0000, which is exactly the ground the rest of
 * this project stands on. If this compiles and runs, the toolchain is sound.
 */
export const MODE13H_SAMPLE: SourceFile = {
  name: "MAIN.C",
  text: `#include <dos.h>
#include <conio.h>

#define SCREEN_W 320
#define SCREEN_H 200

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
