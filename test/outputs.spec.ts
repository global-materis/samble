import 'reflect-metadata';
import { Readable, Writable } from 'stream';
import type { Response } from 'express';
import { describe, expect, it } from '@jest/globals';
import { csv, file, Output, pdf, view } from '../lib';

/**
 * Los outputs reemplazaron a `@Template`.
 *
 * La diferencia no es cosmética: el decorador decidía en el arranque, leyendo
 * metadata de la clase, así que un endpoint era "de vista" o no lo era para
 * siempre. Ahora la decisión se toma dentro de `main()`, con los datos en la
 * mano, y el mismo endpoint puede responder JSON o un archivo según lo que le
 * pidan.
 */

/** Una Response de mentira que igual es un Writable, para poder pipear. */
class FakeResponse extends Writable {
  public typeValue?: string;
  public headers: Record<string, string> = {};
  public sent?: string | Buffer;
  public rendered?: { template: string; data: object };
  public renderError: Error | null = null;
  public html = '<h1>ok</h1>';
  private chunks: Buffer[] = [];

  public _write(
    chunk: Buffer,
    _encoding: string,
    done: (error?: Error | null) => void,
  ): void {
    this.chunks.push(Buffer.from(chunk));
    done();
  }

  /** Lo que llegó por el pipe, a diferencia de lo que llegó por `send()`. */
  public get piped(): Buffer {
    return Buffer.concat(this.chunks);
  }

  public type(value: string): this {
    this.typeValue = value;
    return this;
  }

  public setHeader(name: string, value: string): this {
    this.headers[name] = value;
    return this;
  }

  public send(body: string | Buffer): this {
    this.sent = body;
    return this;
  }

  public render(
    template: string,
    data: object,
    callback: (error: Error | null, html?: string) => void,
  ): void {
    this.rendered = { template, data };
    if (this.renderError) {
      callback(this.renderError);
      return;
    }
    callback(null, this.html);
  }
}

const send = async (output: Output, res = new FakeResponse()) => {
  await output.send(res as unknown as Response);
  return res;
};

/** El texto del CSV sin la marca de orden de bytes. */
// \uFEFF y no el carácter suelto: un BOM escrito literal es invisible.
const sinBom = (res: FakeResponse) => String(res.sent).replace(/^\uFEFF/, '');

describe('view()', () => {
  it('renderiza la plantilla con sus datos y manda el html', async () => {
    const res = await send(view('products', { products: [1, 2] }));

    expect(res.rendered).toEqual({
      template: 'products',
      data: { products: [1, 2] },
    });
    expect(res.sent).toBe('<h1>ok</h1>');
  });

  it('una plantilla rota REBOTA, no la contesta Express por su cuenta', async () => {
    // Es la razón de usar el render con callback: con `res.render(path, data)`
    // el error se va al manejador de Express y el cliente recibe un stack en
    // HTML, saltándose el contrato de errores del framework.
    const res = new FakeResponse();
    res.renderError = new Error('Failed to lookup view');

    await expect(send(view('nope'), res)).rejects.toThrow('Failed to lookup');
    expect(res.sent).toBeUndefined();
  });
});

describe('csv()', () => {
  const filas = [
    { nombre: 'Ana', saldo: 10 },
    { nombre: 'Luis', saldo: 0 },
  ];

  it('escribe encabezado y filas con CRLF', async () => {
    const res = await send(csv(filas));

    expect(sinBom(res)).toBe('nombre,saldo\r\nAna,10\r\nLuis,0\r\n');
    expect(res.typeValue).toBe('text/csv');
  });

  it('lleva BOM: sin eso la planilla abre los acentos como basura', async () => {
    const res = await send(csv([{ nombre: 'Ñandú' }]));

    expect(String(res.sent).startsWith('﻿')).toBe(true);
    expect(await send(csv([{ a: 1 }], { bom: false })).then(sinBom)).toBe(
      'a\r\n1\r\n',
    );
  });

  it('las columnas eligen QUÉ sale y con qué título', async () => {
    const res = await send(
      csv(filas, { columns: [{ key: 'nombre', header: 'Cliente' }] }),
    );

    expect(sinBom(res)).toBe('Cliente\r\nAna\r\nLuis\r\n');
  });

  it('sin columnas toma todas las claves que aparezcan, en orden', async () => {
    const res = await send(csv([{ a: 1 }, { b: 2 }]));

    expect(sinBom(res)).toBe('a,b\r\n1,\r\n,2\r\n');
  });

  it('entrecomilla lo que rompería la fila', async () => {
    const res = await send(
      csv([{ x: 'a,b', y: 'dice "hola"', z: 'dos\nlíneas', w: ' espacio ' }]),
    );

    expect(sinBom(res)).toBe(
      'x,y,z,w\r\n"a,b","dice ""hola""","dos\nlíneas"," espacio "\r\n',
    );
  });

  it('respeta el separador que pida la planilla', async () => {
    const res = await send(csv([{ a: 'x,y', b: 2 }], { delimiter: ';' }));

    expect(sinBom(res)).toBe('a;b\r\nx,y;2\r\n');
  });

  it('nulos vacíos, fechas en ISO, objetos en JSON', async () => {
    const res = await send(
      csv([
        {
          nada: null,
          falta: undefined,
          cuando: new Date('2026-09-17T03:00:00.000Z'),
          quien: { id: 1 },
        },
      ]),
    );

    expect(sinBom(res)).toBe(
      'nada,falta,cuando,quien\r\n,,2026-09-17T03:00:00.000Z,"{""id"":1}"\r\n',
    );
  });

  it('sin filas ni columnas el archivo queda vacío, no con una línea suelta', async () => {
    const res = await send(csv([], { bom: false }));

    expect(res.sent).toBe('');
  });

  it('se descarga, y el nombre con acentos viaja de las dos formas', async () => {
    const res = await send(csv(filas, { filename: 'Catálogo.csv' }));

    expect(res.headers['Content-Disposition']).toBe(
      'attachment; filename="Cat_logo.csv"; filename*=UTF-8\'\'Cat%C3%A1logo.csv',
    );
  });

  it('acepta entidades: una clase no tiene índice de string', async () => {
    class Producto {
      constructor(
        public id: number,
        public name: string,
      ) {}
    }

    const res = await send(csv([new Producto(1, 'Antena')]));

    expect(sinBom(res)).toBe('id,name\r\n1,Antena\r\n');
  });
});

describe('pdf()', () => {
  it('se muestra en el navegador salvo que pidas descargarlo', async () => {
    const res = await send(pdf(Buffer.from('%PDF-1.4'), { filename: 'r.pdf' }));

    expect(res.typeValue).toBe('application/pdf');
    expect(res.headers['Content-Disposition']).toContain('inline');
    expect(res.sent).toEqual(Buffer.from('%PDF-1.4'));
  });

  it('download: true lo manda a guardar', async () => {
    const res = await send(
      pdf(Buffer.from('%PDF'), { filename: 'r.pdf', download: true }),
    );

    expect(res.headers['Content-Disposition']).toContain('attachment');
  });
});

describe('file()', () => {
  it('sirve para lo que el framework no conoce', async () => {
    const res = await send(
      file(Buffer.from('PK'), { type: 'application/zip', filename: 'f.zip' }),
    );

    expect(res.typeValue).toBe('application/zip');
    expect(res.sent).toEqual(Buffer.from('PK'));
  });

  it('un stream se pipea, no se junta en memoria', async () => {
    const res = await send(
      file(Readable.from([Buffer.from('uno'), Buffer.from('dos')]), {
        type: 'text/plain',
      }),
    );

    expect(res.piped.toString()).toBe('unodos');
    expect(res.sent).toBeUndefined();
  });

  it('si el stream se corta a mitad, corta también la respuesta', async () => {
    // Ya salieron bytes: no se puede contestar un error JSON encima. Lo único
    // honesto es romper la transferencia para que el cliente no se quede con
    // un archivo truncado creyendo que está completo.
    const roto = new Readable({
      read() {
        this.destroy(new Error('disco'));
      },
    });
    const res = new FakeResponse();

    await expect(send(file(roto), res)).rejects.toThrow('disco');
    expect(res.destroyed).toBe(true);
  });
});
