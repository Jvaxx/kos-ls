import { Token } from '../../src/models/token';
import { Literal } from '../../src/models/types';
import { TokenType } from '../../src/models/tokentypes';

export const createToken = <T extends TokenType>(
  type: T,
  lexeme: string,
  literal?: Literal,
): Token<T> => {
  return new Token(
    type,
    lexeme,
    literal,
    {
      line: 0,
      character: 0,
    },
    {
      line: 0,
      character: 1,
    },
    'file:///fake.ks',
  );
};
