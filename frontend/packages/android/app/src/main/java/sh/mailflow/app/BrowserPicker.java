package sh.mailflow.app;

import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.widget.Toast;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class BrowserPicker {
    private BrowserPicker() {}

    static void open(Context context, Uri uri) {
        Intent view = new Intent(Intent.ACTION_VIEW, uri);
        view.addCategory(Intent.CATEGORY_BROWSABLE);

        // An unrelated generic URL prevents verified app links from hiding
        // browsers that can open the actual URL. No browser package whitelist.
        Intent probe = new Intent(Intent.ACTION_VIEW, Uri.parse(uri.getScheme() + "://browser.invalid/"));
        probe.addCategory(Intent.CATEGORY_BROWSABLE);
        PackageManager manager = context.getPackageManager();
        List<ResolveInfo> handlers = manager.queryIntentActivities(probe, PackageManager.MATCH_DEFAULT_ONLY);
        Map<String, ResolveInfo> byPackage = new LinkedHashMap<>();
        for (ResolveInfo handler : handlers) {
            if (!handler.handleAllWebDataURI || handler.activityInfo == null || !handler.activityInfo.exported
                || context.getPackageName().equals(handler.activityInfo.packageName)) continue;
            byPackage.putIfAbsent(handler.activityInfo.packageName, handler);
        }

        ArrayList<ResolveInfo> browsers = new ArrayList<>(byPackage.values());
        if (browsers.isEmpty()) {
            Toast.makeText(context, R.string.no_browser_available, Toast.LENGTH_LONG).show();
            return;
        }
        CharSequence[] labels = new CharSequence[browsers.size()];
        for (int i = 0; i < browsers.size(); i++) labels[i] = browsers.get(i).loadLabel(manager);
        // A full list avoids OEM resolver filtering and the system chooser's
        // limited EXTRA_INITIAL_INTENTS list. Large lists scroll normally.
        new AlertDialog.Builder(context)
            .setTitle(R.string.open_in_browser)
            .setItems(labels, (dialog, index) -> {
                ResolveInfo browser = browsers.get(index);
                Intent explicit = new Intent(view);
                explicit.setComponent(new ComponentName(browser.activityInfo.packageName, browser.activityInfo.name));
                try {
                    context.startActivity(explicit);
                } catch (ActivityNotFoundException | SecurityException error) {
                    Toast.makeText(context, R.string.no_browser_available, Toast.LENGTH_LONG).show();
                }
            })
            .setNegativeButton(android.R.string.cancel, null)
            .show();
    }
}
