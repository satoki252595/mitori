package legacy;

import java.util.ArrayList;
import java.util.List;

/** The pile as the old desktop client kept it. */
public class Foo {
    private final List<String> titles = new ArrayList<>();

    public void add(String title) {
        titles.add(title);
    }

    public int size() {
        return titles.size();
    }
}
