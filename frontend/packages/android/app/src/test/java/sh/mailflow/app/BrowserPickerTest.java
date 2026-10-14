package sh.mailflow.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.widget.ListView;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowAlertDialog;
import org.robolectric.shadows.ShadowPackageManager;
import org.robolectric.shadows.ShadowToast;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class BrowserPickerTest {
    private ResolveInfo handler(String name, String packageName, boolean browser) {
        ResolveInfo info = new ResolveInfo();
        info.nonLocalizedLabel = name;
        info.filter = new IntentFilter(Intent.ACTION_VIEW);
        info.filter.addCategory(Intent.CATEGORY_DEFAULT);
        info.filter.addCategory(Intent.CATEGORY_BROWSABLE);
        info.filter.addDataScheme("https");
        if (!browser) info.filter.addDataAuthority("shopping.example", null);
        info.activityInfo = new ActivityInfo();
        info.activityInfo.packageName = packageName;
        info.activityInfo.name = packageName + ".BrowserActivity";
        info.activityInfo.exported = true;
        info.activityInfo.enabled = true;
        info.activityInfo.applicationInfo = new ApplicationInfo();
        info.activityInfo.applicationInfo.packageName = packageName;
        info.activityInfo.applicationInfo.enabled = true;
        return info;
    }

    @Test
    public void includesMoreThanThreeBrowsersAndOpensEdgeWithTheOriginalLink() {
        Activity activity = Robolectric.buildActivity(Activity.class).setup().get();
        ShadowPackageManager manager = Shadows.shadowOf(activity.getPackageManager());
        Intent probe = new Intent(Intent.ACTION_VIEW, Uri.parse("https://browser.invalid/"));
        probe.addCategory(Intent.CATEGORY_BROWSABLE);
        manager.addResolveInfoForIntent(probe, handler("Browser", "browser.one", true));
        manager.addResolveInfoForIntent(probe, handler("Chrome", "browser.two", true));
        manager.addResolveInfoForIntent(probe, handler("Firefox", "browser.three", true));
        manager.addResolveInfoForIntent(probe, handler("Edge", "com.microsoft.emmx", true));
        manager.addResolveInfoForIntent(probe, handler("Edge duplicate", "com.microsoft.emmx", true));
        manager.addResolveInfoForIntent(probe, handler("WPS", "office.app", false));
        manager.addResolveInfoForIntent(probe, handler("Taobao", "shopping.app", false));

        Uri link = Uri.parse("https://shopping.example/item?token=a%2Bb#details");
        BrowserPicker.open(activity, link);
        AlertDialog dialog = ShadowAlertDialog.getLatestAlertDialog();
        assertNotNull(dialog);
        ListView list = dialog.getListView();
        assertEquals(4, list.getAdapter().getCount());
        assertEquals("Edge", list.getAdapter().getItem(3).toString());
        list.performItemClick(list.getAdapter().getView(3, null, list), 3, list.getAdapter().getItemId(3));
        Intent launched = Shadows.shadowOf(activity).getNextStartedActivity();
        assertEquals("com.microsoft.emmx", launched.getComponent().getPackageName());
        assertEquals(link, launched.getData());
        assertTrue(launched.hasCategory(Intent.CATEGORY_BROWSABLE));
    }

    @Test
    public void emptyBrowserListShowsAnExplanation() {
        Activity activity = Robolectric.buildActivity(Activity.class).setup().get();
        BrowserPicker.open(activity, Uri.parse("https://example.invalid/"));
        assertEquals(activity.getString(R.string.no_browser_available), ShadowToast.getTextOfLatestToast());
    }
}
