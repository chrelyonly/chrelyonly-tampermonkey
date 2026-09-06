package cn.chrelyonly.chrelyonlytampermonkey.config;

import cn.chrelyonly.chrelyonlytampermonkey.component.R;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.webmvc.autoconfigure.error.AbstractErrorController;
import org.springframework.boot.webmvc.error.ErrorAttributes;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * @author chrelyonly
 * 重写异常处理
 */
@RestControllerAdvice(basePackages = "cn.chrelyonly")
@Slf4j
@RestController
@RequestMapping("${server.error.path:${error.path:/error}}")
public class MyException extends AbstractErrorController {

    public MyException(ErrorAttributes errorAttributes) {
        super(errorAttributes);
    }

    /**
     * 重写异常处理报错
     * @param d 异常
     * @return R
     */
    @ExceptionHandler(Exception.class)
    public R<Object> handler(Exception d) {
        d.printStackTrace();
        return R.fail("系统异常，请联系管理员");
    }

    /**
     * 覆盖默认错误页面
     */
    @RequestMapping
    public R<String> error() {
        return R.fail("系统异常，请联系管理员");
    }



}
