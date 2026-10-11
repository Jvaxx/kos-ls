import { convertInline, rstToMarkdown } from '../../tools/kos-db/markdown';
import { emptyModel, parseRst, parseSignature } from '../../tools/kos-db/rst';

describe('RST to Markdown', () => {
  test('converts inline markup', () => {
    expect(
      convertInline(
        'A :struct:`Vessel`, :attr:`~Vessel:MASS`, :ref:`parts <parts and modules>`, ``SHIP``, :math:`x^2` and `site <https://x.org>`_',
      ),
    ).toBe('A `Vessel`, `MASS`, parts, `SHIP`, $x^2$ and [site](https://x.org)');
    expect(convertInline(':meth:`String:MATCHESPATTERN`\\ .')).toBe(
      '`String:MATCHESPATTERN`.',
    );
  });

  test('converts literal blocks, admonitions and version notes', () => {
    const md = rstToMarkdown(
      `Rounds a number::

    PRINT ROUND(1.887). // prints 2

.. note::
    Only on the active vessel.

    Really.

.. versionadded:: 1.1.0

.. image:: /_images/x.png

#. first`.split('\n'),
    );
    expect(md).toBe(
      [
        'Rounds a number:',
        '',
        '```kerboscript',
        'PRINT ROUND(1.887). // prints 2',
        '```',
        '',
        '> **Note:** Only on the active vessel.',
        '>',
        '> Really.',
        '',
        '*Added in kOS 1.1.0.*',
        '',
        '1. first',
      ].join('\n'),
    );
  });

  test('converts list tables', () => {
    const md = rstToMarkdown(
      `.. list-table:: Members
    :header-rows: 1

    * - Suffix
      - Type
    * - :attr:\`READY\`
      - :struct:\`Boolean\``.split('\n'),
    );
    expect(md).toBe(
      ['| Suffix | Type |', '| --- | --- |', '| `READY` | `Boolean` |'].join(
        '\n',
      ),
    );
  });
});

describe('RST extraction', () => {
  test('parses irregular signatures', () => {
    expect(parseSignature('Vessel:PARTSNAMED(name)')).toEqual({
      prefix: 'Vessel',
      name: 'PARTSNAMED',
      params: [{ name: 'name', optional: false, variadic: false }],
    });
    expect(parseSignature('GeoCoordinates:ALTITUDEPOSITION (altitude)')).toMatchObject({
      name: 'ALTITUDEPOSITION',
      params: [{ name: 'altitude' }],
    });
    expect(parseSignature('GUI(width [, height])').params).toEqual([
      { name: 'width', optional: false, variadic: false },
      { name: 'height', optional: true, variadic: false },
    ]);
    expect(parseSignature('RUNPATH(path, args...)').params).toEqual([
      { name: 'path', optional: false, variadic: false },
      { name: 'args', optional: false, variadic: true },
    ]);
    expect(parseSignature('VANG(v1,v2)::')).toMatchObject({ name: 'VANG' });
    expect(parseSignature('ADDPOPUPMENU')).toEqual({ name: 'ADDPOPUPMENU' });
  });

  test('reads structures, members and fields', () => {
    const model = emptyModel();
    parseRst(
      `Engine
======

.. structure:: Engine

    .. list-table:: Members
        :header-rows: 1

        * - Suffix
          - Type (units)
          - Description
        * - All suffixes of :struct:\`Part\`
          -
          -
        * - :attr:\`THRUST\`
          - :struct:\`Scalar\` (kN)
          - Current thrust

.. attribute:: Engine:ISP

    :access: Get only
    :type: :struct:\`Scalar\`

    Specific impulse.

.. method:: PARTSNAMED(name)

    :parameter name: (:struct:\`String\`) Name of the parts
    :return: :struct:\`List\` of :struct:\`Part\` objects

    Parts with this name.
`,
      'structures/vessels/engine.rst',
      model,
    );

    const engine = model.structures.get('ENGINE')!;
    expect(engine.inherits).toBe('Part');
    expect(engine.url).toBe('structures/vessels/engine.html#structure:ENGINE');
    expect(engine.tableRows.get('THRUST')).toEqual({
      type: ':struct:`Scalar` (kN)',
      access: undefined,
      doc: 'Current thrust',
    });
    expect(engine.members.get('ISP')).toMatchObject({
      access: 'Get only',
      type: ':struct:`Scalar`',
      doc: 'Specific impulse.',
      url: 'structures/vessels/engine.html#attribute:ENGINE:ISP',
    });
    // a member without prefix belongs to the current structure
    expect(engine.members.get('PARTSNAMED')).toMatchObject({
      returns: ':struct:`List` of :struct:`Part` objects',
      params: [{ name: 'name', type: ':struct:`String`', doc: 'Name of the parts' }],
      doc: 'Parts with this name.',
    });
  });

  test('reads functions with overloads and globals', () => {
    const model = emptyModel();
    parseRst(
      `.. function:: ROUND(a)

    Rounds.

.. function:: ROUND(a,b)

    :parameter a: (number)
    :type b: :struct:\`Scalar\`
    :return: (number) rounded

.. global:: RCS

    :access: get/set
    :type: :struct:\`Boolean\`
`,
      'math/basic.rst',
      model,
    );

    expect(model.functions.get('ROUND')!.map((f) => f.params)).toEqual([
      [{ name: 'a', optional: false, variadic: false }],
      [
        { name: 'a', optional: false, variadic: false, type: 'number' },
        { name: 'b', optional: false, variadic: false, type: ':struct:`Scalar`' },
      ],
    ]);
    expect(model.functions.get('ROUND')![1].returns).toBe('(number) rounded');
    expect(model.globals.get('RCS')).toMatchObject({
      access: 'get/set',
      type: ':struct:`Boolean`',
      url: 'math/basic.html#global:RCS',
    });
  });
});
