class MathHelpers:
    @staticmethod
    def f_eq(a, b, tolerance=0.00001):
        return abs(a - b) <= tolerance

    @staticmethod
    def f_ne(a, b, tolerance=0.00001):
        return abs(a - b) > tolerance

    @staticmethod
    def f_gt(a, b, tolerance=0.00001):
        return abs(a - b) > tolerance and a > b

    @staticmethod
    def f_ge(a, b, tolerance=0.00001):
        return abs(a - b) <= tolerance or a > b

    @staticmethod
    def f_lt(a, b, tolerance=0.00001):
        return abs(a - b) > tolerance and a < b

    @staticmethod
    def f_le(a, b, tolerance=0.00001):
        return abs(a - b) <= tolerance or a < b

    @staticmethod
    def f_is_int(a, tolerance=0.00001):
        try:
            number = float(a)
        except (TypeError, ValueError):
            return False
        return abs(number - round(number)) <= tolerance

    @staticmethod
    def f_zero(a, tolerance=0.00001):
        return 0 if abs(a) < tolerance else a


math = MathHelpers
