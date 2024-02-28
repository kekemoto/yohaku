import { interprete } from "./interpreter.ts";

interprete(`
           a = if false { 1 } { null }

           c = match a { Num x { print (add x 1) } Null a { print a }
             else a { print 3 }
           }
`);
